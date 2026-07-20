import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { and, asc, desc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, maintainDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { checkpointStashSha, deleteCheckpointRefs, restoreCheckpoint } from '../../git/ops'
import { createWorktree, ensureBaseCommit, isGitRepo, removeWorktree } from '../../git/worktree'
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
      // Worktrees need a base commit; bootstrap one for repos with an unborn
      // HEAD so isolation works even for freshly-initialized projects. Only
      // non-git project dirs fall back to running at the project root.
      if (input.useWorktree && (await isGitRepo(project.path))) {
        await ensureBaseCommit(project.path)
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
    // The cascade can free a lot of message pages — reclaim them promptly.
    maintainDb()
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

      // Rewind-and-inform support: the last surviving assistant message
      // anchors the agent-memory cut (assistant ids in our DB are SDK
      // message ids), and the rolled-back user text goes into the note.
      // Skip pure-info rows: transcript markers use role 'assistant' but
      // local UUIDs the SDK thread has never seen.
      const anchor = db
        .select({ id: schema.messages.id, parts: schema.messages.parts })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.subchatId, input.subchatId),
            eq(schema.messages.role, 'assistant'),
            lt(schema.messages.seq, msg.seq)
          )
        )
        .orderBy(desc(schema.messages.seq))
        .limit(20)
        .all()
        .find((row) => {
          try {
            const parts = JSON.parse(row.parts) as Array<{ type: string }>
            return parts.some((p) => p.type !== 'info')
          } catch {
            return false
          }
        })
      let rolledBackText = ''
      try {
        const parts = JSON.parse(msg.parts) as Array<{ type: string; text?: string }>
        rolledBackText = parts.find((p) => p.type === 'text')?.text?.slice(0, 200) ?? ''
      } catch {
        // Unparseable parts — note simply omits the quoted text.
      }

      // Stop the agent and wait for the process to exit so it can't be
      // mid-write while we hard-reset the working tree below.
      await agentSessionManager.stopHostAndWait(input.subchatId)

      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, chat.projectId))
        .get()

      // Restore at the same cwd checkpoints are captured (see subchatCwd in
      // agent.ts): no-worktree chats run at the project root.
      const cwd = chat.worktreePath ?? project?.path ?? null
      let warning: string | null = null
      let changedFiles: string[] = []
      if (msg.checkpointRef && cwd) {
        if (!existsSync(cwd)) {
          throw new Error(`Cannot restore snapshot: folder no longer exists: ${cwd}`)
        }
        const restored = await restoreCheckpoint(cwd, msg.checkpointRef)
        warning = restored.warning
        changedFiles = restored.changedFiles
      }

      // Unpin checkpoint stashes of the messages being deleted. The target's
      // own ref is included only now that its restore (if any) succeeded.
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
      // Truncating a long transcript frees pages — reclaim them promptly.
      maintainDb()
      if (!anchor) {
        // Rolled back to the very start: a fresh empty thread matches the
        // now-empty chat, so there's nothing to remember or inform.
        db.update(schema.subchats)
          .set({ mastraThreadId: null })
          .where(eq(schema.subchats.id, input.subchatId))
          .run()
      }
      // Live stream subscriptions are only seeded on connect, so push the
      // truncated history to any open chat view immediately.
      agentSessionManager.notifyMessagesReset(input.subchatId)

      if (anchor) {
        // Partial rollback: keep the agent's thread, delete its memory of
        // the rolled-back exchanges, and store a note that the next message
        // send appends to the model-bound prompt (SDK-persisted reminders
        // are filtered out of recall, so we deliver the note ourselves).
        // Awaiting here (host reboot included) prevents racing the user's
        // next message; the old flow paid the same boot cost anyway.
        const shown = changedFiles.slice(0, 20)
        const filesSentence =
          shown.length > 0
            ? `Files affected by the revert: ${shown.join(', ')}` +
              (changedFiles.length > shown.length
                ? ` … and ${changedFiles.length - shown.length} more. `
                : '. ')
            : ''
        const note =
          '[Rollback] The user rolled back this conversation and the project files. ' +
          'Files on disk were restored to the snapshot taken before the user message: ' +
          `"${rolledBackText}". ${filesSentence}All file changes and conversation turns ` +
          'after that point were discarded. The current files on disk are authoritative — ' +
          're-read files before relying on earlier knowledge of them.'
        db.update(schema.subchats)
          .set({ pendingNote: note })
          .where(eq(schema.subchats.id, input.subchatId))
          .run()
        try {
          await agentSessionManager.rewindThread(input.subchatId, anchor.id)
        } catch (err) {
          // Files and chat DB are already restored — degrade to a warning.
          const m = `Agent memory rewind failed: ${err instanceof Error ? err.message : String(err)}`
          warning = warning ? `${warning}\n${m}` : m
        }
      }

      return { ok: true, warning }
    })
})
