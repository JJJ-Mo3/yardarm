/**
 * Side-question router (`/btw`): quick questions about the current chat,
 * answered in a hidden per-chat helper chat so the main chat's thread, queue
 * and agent are never touched. The helper follows the hidden "Codebase Q&A"
 * pattern — hidden chat row, no worktree of its own, forced YOLO because no
 * chat pane watches it — and is linked through chats.side_of_chat_id (cascade
 * deleted with the chat it belongs to; the session manager runs it in that
 * chat's working directory). It boots in plan mode (the SDK's read-only mode)
 * and every question carries read-only instructions plus a fresh, size-capped
 * digest of the main conversation's recent user/assistant text.
 */
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  SIDE_CHAT_TITLE,
  SIDE_QUESTION_MAX,
  buildChatDigest,
  buildSideQuestionMarker,
  buildSideQuestionPrompt
} from '@shared/side-question'
import { getDb, maintainDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { createChatWithSubchat } from '../../agent/chat-factory'
import { publicProcedure, router } from '../trpc'

/** The (non-helper) chat a subchat belongs to, with that subchat's model. */
function resolveMainChat(subchatId: string): {
  chatId: string
  projectId: string
  modelId: string | null
} {
  const row = getDb()
    .select({
      chatId: schema.chats.id,
      projectId: schema.chats.projectId,
      sideOfChatId: schema.chats.sideOfChatId,
      modelId: schema.subchats.modelId
    })
    .from(schema.subchats)
    .innerJoin(schema.chats, eq(schema.chats.id, schema.subchats.chatId))
    .where(eq(schema.subchats.id, subchatId))
    .get()
  if (!row) throw new Error('Chat not found')
  if (row.sideOfChatId) throw new Error('Side questions cannot be asked from a side conversation')
  return { chatId: row.chatId, projectId: row.projectId, modelId: row.modelId }
}

/** The chat's existing helper chat + its subchat, without creating one. */
function resolveHelper(mainChatId: string): { chatId: string; subchatId: string } | null {
  const db = getDb()
  const helper = db
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(and(eq(schema.chats.sideOfChatId, mainChatId), eq(schema.chats.archived, false)))
    .orderBy(asc(schema.chats.createdAt))
    .get()
  if (!helper) return null
  const subchat = db
    .select({ id: schema.subchats.id })
    .from(schema.subchats)
    .where(eq(schema.subchats.chatId, helper.id))
    .orderBy(asc(schema.subchats.createdAt))
    .get()
  if (!subchat) return null
  return { chatId: helper.id, subchatId: subchat.id }
}

export const sideQuestionRouter = router({
  /**
   * The helper conversation for the chat that owns `subchatId`, when one
   * exists. Never creates — the panel uses it to show earlier side questions.
   */
  target: publicProcedure.input(z.object({ subchatId: z.string() })).query(({ input }) => {
    return resolveHelper(resolveMainChat(input.subchatId).chatId)
  }),

  /**
   * Ask a side question about the conversation in `subchatId`. Creates the
   * hidden helper chat on first use; follow-ups reuse it, so they share one
   * side conversation. Reads the main conversation's stored messages only.
   */
  ask: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        question: z.string().trim().min(1).max(SIDE_QUESTION_MAX)
      })
    )
    .mutation(async ({ input }) => {
      const main = resolveMainChat(input.subchatId)
      let target = resolveHelper(main.chatId)
      if (!target) {
        const created = await createChatWithSubchat({
          projectId: main.projectId,
          title: SIDE_CHAT_TITLE,
          useWorktree: false,
          hidden: true,
          sideOfChatId: main.chatId,
          // Answer with the model the user is already talking to.
          modelId: main.modelId ?? undefined
        })
        const subchatId = created.subchats[0].id
        if (!subchatId) throw new Error('Side conversation could not be created')
        // Plan mode is the agent's read-only mode; set before any host boots.
        getDb()
          .update(schema.subchats)
          .set({ mode: 'plan' })
          .where(eq(schema.subchats.id, subchatId))
          .run()
        target = { chatId: created.id, subchatId }
      }
      const digest = buildChatDigest(agentSessionManager.loadMessages(input.subchatId))
      await agentSessionManager.setYolo(target.subchatId, true)
      await agentSessionManager.sendOrQueue(
        target.subchatId,
        buildSideQuestionPrompt(input.question, digest),
        undefined,
        buildSideQuestionMarker(input.question),
        'marker'
      )
      return target
    }),

  /** Discard the chat's side conversation (helper chat + its agent thread host). */
  clear: publicProcedure.input(z.object({ subchatId: z.string() })).mutation(async ({ input }) => {
    const main = resolveMainChat(input.subchatId)
    const db = getDb()
    const helpers = db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(eq(schema.chats.sideOfChatId, main.chatId))
      .all()
    for (const helper of helpers) {
      const subchats = db
        .select({ id: schema.subchats.id })
        .from(schema.subchats)
        .where(eq(schema.subchats.chatId, helper.id))
        .all()
      await Promise.all(subchats.map((sc) => agentSessionManager.stopHostAndWait(sc.id)))
      db.delete(schema.chats).where(eq(schema.chats.id, helper.id)).run()
    }
    if (helpers.length > 0) maintainDb()
    return { ok: true }
  })
})
