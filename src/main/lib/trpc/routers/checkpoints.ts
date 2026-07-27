/**
 * Checkpoint manager: named (manual) snapshots alongside the per-message
 * auto checkpoints, tree-to-tree compare between any two snapshots, and
 * pruning of keep-alive refs (refs/yardarm/checkpoints/*) nothing
 * references anymore.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import {
  captureCheckpoint,
  deleteCheckpointRefs,
  diffRefs,
  listCheckpointRefs,
  refFileDiff
} from '../../git/ops'
import { collectKeepShas, pruneEligibleShas } from '../../git/checkpoint-prune'
import { publicProcedure, router } from '../trpc'

export interface CheckpointEntry {
  /** Named rows use their DB id; auto entries use `msg:<messageId>`. */
  id: string
  name: string | null
  tag: string | null
  headSha: string
  stashSha: string | null
  source: 'auto' | 'manual'
  messageId: string | null
  createdAt: number
}

function chatContext(chatId: string): {
  cwd: string
  projectPath: string
  projectId: string
} {
  const db = getDb()
  const chat = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
  if (!chat) throw new Error('Chat not found')
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, chat.projectId))
    .get()
  if (!project) throw new Error('Project not found')
  const cwd = chat.worktreePath ?? project.path
  if (!existsSync(cwd)) throw new Error(`Folder no longer exists: ${cwd}`)
  return { cwd, projectPath: project.path, projectId: project.id }
}

/** Auto checkpoints for a chat, parsed from its messages' rollback anchors. */
function autoEntries(chatId: string): CheckpointEntry[] {
  const db = getDb()
  const rows = db
    .select({
      messageId: schema.messages.id,
      checkpointRef: schema.messages.checkpointRef,
      createdAt: schema.messages.createdAt
    })
    .from(schema.messages)
    .innerJoin(schema.subchats, eq(schema.subchats.id, schema.messages.subchatId))
    .where(and(eq(schema.subchats.chatId, chatId), isNotNull(schema.messages.checkpointRef)))
    .all()
  const entries: CheckpointEntry[] = []
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.checkpointRef ?? '') as { head: string; stash: string | null }
      if (!parsed.head) continue
      entries.push({
        id: `msg:${r.messageId}`,
        name: null,
        tag: null,
        headSha: parsed.head,
        stashSha: parsed.stash ?? null,
        source: 'auto',
        messageId: r.messageId,
        createdAt: r.createdAt
      })
    } catch {
      // malformed anchor — skip
    }
  }
  return entries
}

/** Stash shas that must stay pinned: every message anchor + named row, project-wide. */
function projectKeepShas(projectId: string): Set<string> {
  const db = getDb()
  const messageRefs = db
    .select({ checkpointRef: schema.messages.checkpointRef })
    .from(schema.messages)
    .innerJoin(schema.subchats, eq(schema.subchats.id, schema.messages.subchatId))
    .innerJoin(schema.chats, eq(schema.chats.id, schema.subchats.chatId))
    .where(and(eq(schema.chats.projectId, projectId), isNotNull(schema.messages.checkpointRef)))
    .all()
  const namedRows = db
    .select({ stashSha: schema.checkpoints.stashSha })
    .from(schema.checkpoints)
    .innerJoin(schema.chats, eq(schema.chats.id, schema.checkpoints.chatId))
    .where(eq(schema.chats.projectId, projectId))
    .all()
  return collectKeepShas(
    messageRefs.map((r) => r.checkpointRef),
    namedRows.map((r) => r.stashSha)
  )
}

const chatInput = z.object({ chatId: z.string() })
const snapshotSpec = z.object({ headSha: z.string().min(1), stashSha: z.string().nullish() })

export const checkpointsRouter = router({
  /** Named + auto checkpoints for a chat, newest first. */
  list: publicProcedure.input(chatInput).query(({ input }): CheckpointEntry[] => {
    const named = getDb()
      .select()
      .from(schema.checkpoints)
      .where(eq(schema.checkpoints.chatId, input.chatId))
      .orderBy(desc(schema.checkpoints.createdAt))
      .all()
      .map((r): CheckpointEntry => ({
        id: r.id,
        name: r.name,
        tag: r.tag,
        headSha: r.headSha,
        stashSha: r.stashSha,
        source: r.source === 'manual' ? 'manual' : 'auto',
        messageId: r.messageId,
        createdAt: r.createdAt
      }))
    return [...named, ...autoEntries(input.chatId)].sort((a, b) => b.createdAt - a.createdAt)
  }),

  /** Snapshot the working tree right now as a named checkpoint. */
  create: publicProcedure
    .input(chatInput.extend({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { cwd } = chatContext(input.chatId)
      const ref = await captureCheckpoint(cwd)
      if (!ref) throw new Error('Could not capture a checkpoint — is this folder a git repo?')
      const parsed = JSON.parse(ref) as { head: string; stash: string | null }
      const row = {
        id: randomUUID(),
        chatId: input.chatId,
        name: input.name.trim(),
        tag: null,
        headSha: parsed.head,
        stashSha: parsed.stash ?? null,
        source: 'manual',
        messageId: null,
        createdAt: Date.now()
      }
      getDb().insert(schema.checkpoints).values(row).run()
      return row
    }),

  /** Rename a named checkpoint and/or set its tag. */
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        tag: z.string().nullable().optional()
      })
    )
    .mutation(({ input }) => {
      const updates: Record<string, unknown> = {}
      if (input.name !== undefined) updates.name = input.name.trim()
      if (input.tag !== undefined) updates.tag = input.tag?.trim() || null
      if (Object.keys(updates).length > 0) {
        getDb()
          .update(schema.checkpoints)
          .set(updates)
          .where(eq(schema.checkpoints.id, input.id))
          .run()
      }
      return { ok: true }
    }),

  /** Delete a named checkpoint, unpinning its stash unless still referenced. */
  remove: publicProcedure
    .input(chatInput.extend({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const row = db
        .select()
        .from(schema.checkpoints)
        .where(eq(schema.checkpoints.id, input.id))
        .get()
      if (!row) return { ok: true }
      const { projectPath, projectId } = chatContext(input.chatId)
      db.delete(schema.checkpoints).where(eq(schema.checkpoints.id, input.id)).run()
      if (row.stashSha && !projectKeepShas(projectId).has(row.stashSha)) {
        await deleteCheckpointRefs(projectPath, [row.stashSha])
      }
      return { ok: true }
    }),

  /** Files that differ between two snapshots (stash tree, else head). */
  compare: publicProcedure
    .input(chatInput.extend({ a: snapshotSpec, b: snapshotSpec }))
    .query(({ input }) => {
      const { cwd } = chatContext(input.chatId)
      return diffRefs(cwd, input.a.stashSha ?? input.a.headSha, input.b.stashSha ?? input.b.headSha)
    }),

  /** One file's contents in snapshot A vs snapshot B. */
  compareFile: publicProcedure
    .input(chatInput.extend({ a: snapshotSpec, b: snapshotSpec, path: z.string().min(1) }))
    .query(({ input }) => {
      const { cwd } = chatContext(input.chatId)
      return refFileDiff(
        cwd,
        input.a.stashSha ?? input.a.headSha,
        input.b.stashSha ?? input.b.headSha,
        input.path
      )
    }),

  /**
   * Delete keep-alive refs nothing references anymore (no message rollback
   * anchor and no named checkpoint, across the whole project — the refs
   * live in the shared git dir).
   */
  prune: publicProcedure.input(chatInput).mutation(async ({ input }) => {
    const { projectPath, projectId } = chatContext(input.chatId)
    const pinned = await listCheckpointRefs(projectPath)
    const eligible = pruneEligibleShas(pinned, projectKeepShas(projectId))
    await deleteCheckpointRefs(projectPath, eligible)
    return { deleted: eligible.length }
  })
})
