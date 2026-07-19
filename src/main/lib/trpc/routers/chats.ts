import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { checkpointStashSha, deleteCheckpointRefs, restoreCheckpoint } from '../../git/ops'
import { createWorktree, hasCommits, removeWorktree } from '../../git/worktree'
import { ptyManager } from '../../terminal/pty-manager'
import { publicProcedure, router } from '../trpc'

export const chatsRouter = router({
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
    return getDb()
      .select()
      .from(schema.chats)
      .where(eq(schema.chats.projectId, input.projectId))
      .orderBy(desc(schema.chats.updatedAt))
      .all()
  }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDb()
    const chat = db.select().from(schema.chats).where(eq(schema.chats.id, input.id)).get()
    if (!chat) return null
    const subchats = db
      .select()
      .from(schema.subchats)
      .where(eq(schema.subchats.chatId, input.id))
      .orderBy(asc(schema.subchats.createdAt))
      .all()
    return { ...chat, subchats }
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        useWorktree: z.boolean().default(true),
        baseBranch: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, input.projectId))
        .get()
      if (!project) throw new Error('Project not found')

      const chatId = randomUUID()
      const base = input.baseBranch ?? project.defaultBranch ?? 'main'

      let worktreePath: string | null = null
      let branch: string | null = null
      // Worktrees need a base commit; a freshly-initialized repo has none, so
      // fall back to running the chat at the project root ("no worktree").
      if (input.useWorktree && (await hasCommits(project.path))) {
        const wt = await createWorktree(project.id, project.path, chatId, input.title, base)
        worktreePath = wt.worktreePath
        branch = wt.branch
      }

      const now = Date.now()
      const chat = {
        id: chatId,
        projectId: project.id,
        title: input.title,
        worktreePath,
        branch,
        baseBranch: base,
        status: 'active',
        archived: false,
        createdAt: now,
        updatedAt: now
      }
      db.insert(schema.chats).values(chat).run()

      const subchat = {
        id: randomUUID(),
        chatId,
        mastraThreadId: null,
        mode: 'build',
        modelId: null,
        thinkingLevel: null,
        createdAt: now,
        updatedAt: now
      }
      db.insert(schema.subchats).values(subchat).run()

      return { ...chat, subchats: [subchat] }
    }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().min(1) }))
    .mutation(({ input }) => {
      getDb()
        .update(schema.chats)
        .set({ title: input.title, updatedAt: Date.now() })
        .where(eq(schema.chats.id, input.id))
        .run()
      return { ok: true }
    }),

  setArchived: publicProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(({ input }) => {
      getDb()
        .update(schema.chats)
        .set({ archived: input.archived, updatedAt: Date.now() })
        .where(eq(schema.chats.id, input.id))
        .run()
      return { ok: true }
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const db = getDb()
    const chat = db.select().from(schema.chats).where(eq(schema.chats.id, input.id)).get()
    if (!chat) return { ok: true }

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, chat.projectId))
      .get()

    // Stop hosts + terminals rooted in the worktree, then clean up.
    const subchats = db
      .select()
      .from(schema.subchats)
      .where(eq(schema.subchats.chatId, chat.id))
      .all()
    for (const sc of subchats) agentSessionManager.stopHost(sc.id)

    // Unpin checkpoint stash commits so the repo doesn't grow unboundedly.
    // Refs live in the main repo's git dir (shared with its worktrees).
    if (project && subchats.length > 0) {
      const refs = db
        .select({ checkpointRef: schema.messages.checkpointRef })
        .from(schema.messages)
        .where(
          and(
            inArray(
              schema.messages.subchatId,
              subchats.map((sc) => sc.id)
            ),
            isNotNull(schema.messages.checkpointRef)
          )
        )
        .all()
      const stashShas = refs
        .map((r) => (r.checkpointRef ? checkpointStashSha(r.checkpointRef) : null))
        .filter((sha): sha is string => sha !== null)
      await deleteCheckpointRefs(project.path, stashShas)
    }

    if (chat.worktreePath) {
      ptyManager.killByCwdPrefix(chat.worktreePath)
      if (project) {
        await removeWorktree(project.path, chat.worktreePath, chat.branch ?? undefined)
      }
    }

    db.delete(schema.chats).where(eq(schema.chats.id, chat.id)).run()
    return { ok: true }
  }),

  createSubchat: publicProcedure
    .input(z.object({ chatId: z.string(), mastraThreadId: z.string().optional() }))
    .mutation(({ input }) => {
      const now = Date.now()
      const subchat = {
        id: randomUUID(),
        chatId: input.chatId,
        // When preset, the new subchat boots straight into an existing
        // mastracode thread (Threads UI "open as new subchat").
        mastraThreadId: input.mastraThreadId ?? null,
        mode: 'build',
        modelId: null,
        thinkingLevel: null,
        createdAt: now,
        updatedAt: now
      }
      getDb().insert(schema.subchats).values(subchat).run()
      return subchat
    }),

  /**
   * Rollback to the checkpoint captured with a user message: restore the
   * worktree files and delete that message and everything after it.
   */
  rollbackToMessage: publicProcedure
    .input(z.object({ subchatId: z.string(), messageId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const msg = db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, input.messageId))
        .get()
      if (!msg || msg.subchatId !== input.subchatId) throw new Error('Message not found')

      const subchat = db
        .select()
        .from(schema.subchats)
        .where(eq(schema.subchats.id, input.subchatId))
        .get()
      if (!subchat) throw new Error('Subchat not found')
      const chat = db.select().from(schema.chats).where(eq(schema.chats.id, subchat.chatId)).get()
      if (!chat) throw new Error('Chat not found')

      // Stop the agent first so it isn't mid-write during reset.
      agentSessionManager.stopHost(input.subchatId)

      const cwd = chat.worktreePath
      if (msg.checkpointRef && cwd) {
        await restoreCheckpoint(cwd, msg.checkpointRef)
      }

      // Unpin checkpoint stashes of the messages being deleted. The target's
      // own ref is included only now that its restore (if any) succeeded.
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, chat.projectId))
        .get()
      if (project) {
        const truncated = db
          .select({ checkpointRef: schema.messages.checkpointRef })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.subchatId, input.subchatId),
              gte(schema.messages.seq, msg.seq),
              isNotNull(schema.messages.checkpointRef)
            )
          )
          .all()
        const stashShas = truncated
          .map((r) => (r.checkpointRef ? checkpointStashSha(r.checkpointRef) : null))
          .filter((sha): sha is string => sha !== null)
        await deleteCheckpointRefs(project.path, stashShas)
      }

      db.delete(schema.messages)
        .where(
          and(eq(schema.messages.subchatId, input.subchatId), gte(schema.messages.seq, msg.seq))
        )
        .run()
      // Fresh agent thread — old context no longer matches truncated history.
      db.update(schema.subchats)
        .set({ mastraThreadId: null })
        .where(eq(schema.subchats.id, input.subchatId))
        .run()

      return { ok: true }
    })
})
