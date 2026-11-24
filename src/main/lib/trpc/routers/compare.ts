/**
 * Compare router: run one prompt against several models side by side. `create`
 * makes one worktree chat per model (each subchat boots with its model) under
 * a shared chats.compare_group_id; `send` dispatches the prompt to every chat
 * of the group; `group` / `keep` back the "Keep this one" action, which
 * archives — never deletes — the other chats of the comparison.
 */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import {
  COMPARE_MAX_MODELS,
  COMPARE_MIN_MODELS,
  COMPARE_PROMPT_MAX,
  compareChatTitle,
  normalizeCompareModels
} from '@shared/compare'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { createChatWithSubchat } from '../../agent/chat-factory'
import { isGitRepo } from '../../git/worktree'
import { publicProcedure, router } from '../trpc'

interface ComparedChat {
  chatId: string
  subchatId: string
  modelId: string
  title: string
}

/** Non-archived chats of a comparison with their first subchat, oldest first. */
function groupChats(groupId: string): Array<{ chatId: string; subchatId: string }> {
  const db = getDb()
  const chats = db
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(and(eq(schema.chats.compareGroupId, groupId), eq(schema.chats.archived, false)))
    .orderBy(asc(schema.chats.createdAt))
    .all()
  const out: Array<{ chatId: string; subchatId: string }> = []
  for (const c of chats) {
    const sub = db
      .select({ id: schema.subchats.id })
      .from(schema.subchats)
      .where(eq(schema.subchats.chatId, c.id))
      .orderBy(asc(schema.subchats.createdAt))
      .get()
    if (sub) out.push({ chatId: c.id, subchatId: sub.id })
  }
  return out
}

export const compareRouter = router({
  /**
   * Create one new worktree chat per model in the project. Chats are created
   * one after another (worktree setup takes the repo's git lock); a model
   * whose chat could not be created is reported in `failed` and the rest
   * proceed. Worktree setup commands are never approved here — unapproved
   * ones come back in `pendingSetupCommands` for the caller to confirm.
   */
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        prompt: z.string().trim().min(1).max(COMPARE_PROMPT_MAX),
        modelIds: z
          .array(z.string().min(1).max(300))
          .min(COMPARE_MIN_MODELS)
          .max(COMPARE_MAX_MODELS * 2)
      })
    )
    .mutation(async ({ input }) => {
      const models = normalizeCompareModels(input.modelIds)
      if (!models.ok) throw new Error(models.error)
      const project = getDb()
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, input.projectId))
        .get()
      if (!project) throw new Error('Project not found')
      // Without a worktree every compared chat would edit the same folder.
      if (!(await isGitRepo(project.path))) {
        throw new Error(
          'Comparing models needs a git project — each model works in its own worktree.'
        )
      }
      const groupId = randomUUID()
      const chats: ComparedChat[] = []
      const failed: Array<{ modelId: string; error: string }> = []
      let pendingSetupCommands: string[] = []
      for (const modelId of models.modelIds) {
        try {
          const title = compareChatTitle(input.prompt, modelId)
          const created = await createChatWithSubchat({
            projectId: project.id,
            title,
            useWorktree: true,
            modelId,
            compareGroupId: groupId
          })
          const subchatId = created.subchats[0].id
          if (!subchatId) throw new Error('Chat was created without a conversation')
          chats.push({ chatId: created.id, subchatId, modelId, title })
          if (created.pendingSetupCommands.length > 0) {
            pendingSetupCommands = created.pendingSetupCommands
          }
        } catch (err) {
          failed.push({ modelId, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { groupId, chats, failed, pendingSetupCommands }
    }),

  /** Send the same prompt to every (non-archived) chat of a comparison. */
  send: publicProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        prompt: z.string().trim().min(1).max(COMPARE_PROMPT_MAX)
      })
    )
    .mutation(async ({ input }) => {
      const targets = groupChats(input.groupId)
      if (targets.length === 0) throw new Error('Comparison not found')
      const results = await Promise.allSettled(
        targets.map((t) => agentSessionManager.sendOrQueue(t.subchatId, input.prompt))
      )
      const failed: Array<{ chatId: string; error: string }> = []
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          failed.push({
            chatId: targets[i].chatId,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason)
          })
        }
      })
      return { sent: targets.length - failed.length, failed }
    }),

  /**
   * The comparison a subchat's chat belongs to, with the other chats still in
   * it — null when the chat is not part of a comparison or is the only one
   * left (nothing to keep or discard).
   */
  group: publicProcedure.input(z.object({ subchatId: z.string() })).query(({ input }) => {
    const db = getDb()
    const chat = db
      .select({ id: schema.chats.id, groupId: schema.chats.compareGroupId })
      .from(schema.subchats)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.subchats.chatId))
      .where(eq(schema.subchats.id, input.subchatId))
      .get()
    if (!chat?.groupId) return null
    const others = db
      .select({ id: schema.chats.id, title: schema.chats.title })
      .from(schema.chats)
      .where(
        and(
          eq(schema.chats.compareGroupId, chat.groupId),
          eq(schema.chats.archived, false),
          ne(schema.chats.id, chat.id)
        )
      )
      .orderBy(asc(schema.chats.createdAt))
      .all()
    if (others.length === 0) return null
    return { chatId: chat.id, groupId: chat.groupId, others }
  }),

  /**
   * "Keep this one": archive every other chat of the comparison (their
   * worktrees and transcripts stay — archived chats can be restored from the
   * sidebar) and stop their agents so discarded runs don't keep spending.
   */
  keep: publicProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ input }) => {
    const db = getDb()
    const chat = db
      .select({ id: schema.chats.id, groupId: schema.chats.compareGroupId })
      .from(schema.chats)
      .where(eq(schema.chats.id, input.chatId))
      .get()
    if (!chat?.groupId) throw new Error('This chat is not part of a model comparison')
    const others = db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(
        and(
          eq(schema.chats.compareGroupId, chat.groupId),
          eq(schema.chats.archived, false),
          ne(schema.chats.id, chat.id)
        )
      )
      .all()
    const now = Date.now()
    for (const other of others) {
      const subchats = db
        .select({ id: schema.subchats.id })
        .from(schema.subchats)
        .where(eq(schema.subchats.chatId, other.id))
        .all()
      await Promise.all(
        subchats.map((sc) => agentSessionManager.stopHostAndWait(sc.id).catch(() => {}))
      )
      db.update(schema.chats)
        .set({ archived: true, updatedAt: now })
        .where(eq(schema.chats.id, other.id))
        .run()
    }
    return { keptChatId: chat.id, archivedChatIds: others.map((o) => o.id) }
  })
})
