/**
 * Kanban task cards: authored cards in Backlog / To do, dispatching a card
 * creates a chat (± worktree) via the shared chat factory and sends the
 * card's prompt to the agent; the board then tracks the chat's live status.
 */
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { createChatWithSubchat } from '../../agent/chat-factory'
import { publicProcedure, router } from '../trpc'

const authoredColumn = z.enum(['backlog', 'todo'])
const cardColumn = z.enum(['backlog', 'todo', 'done'])

/** Sort order for appending to the end of a column. */
function nextSortOrder(projectId: string, column: string): number {
  const rows = getDb()
    .select({ sortOrder: schema.kanbanCards.sortOrder, column: schema.kanbanCards.column })
    .from(schema.kanbanCards)
    .where(eq(schema.kanbanCards.projectId, projectId))
    .all()
  let max = 0
  for (const r of rows) if (r.column === column && r.sortOrder > max) max = r.sortOrder
  return max + 1
}

export const kanbanRouter = router({
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
    return getDb()
      .select()
      .from(schema.kanbanCards)
      .where(eq(schema.kanbanCards.projectId, input.projectId))
      .orderBy(asc(schema.kanbanCards.sortOrder))
      .all()
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        prompt: z.string().min(1),
        column: authoredColumn.default('backlog'),
        useWorktree: z.boolean().default(true)
      })
    )
    .mutation(({ input }) => {
      const now = Date.now()
      const row = {
        id: randomUUID(),
        projectId: input.projectId,
        title: input.title.trim(),
        prompt: input.prompt.trim(),
        column: input.column,
        sortOrder: nextSortOrder(input.projectId, input.column),
        chatId: null,
        useWorktree: input.useWorktree,
        createdAt: now,
        updatedAt: now
      }
      getDb().insert(schema.kanbanCards).values(row).run()
      return row
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        prompt: z.string().min(1).optional(),
        column: cardColumn.optional(),
        sortOrder: z.number().optional(),
        useWorktree: z.boolean().optional()
      })
    )
    .mutation(({ input }) => {
      const updates: Record<string, unknown> = { updatedAt: Date.now() }
      if (input.title !== undefined) updates.title = input.title.trim()
      if (input.prompt !== undefined) updates.prompt = input.prompt.trim()
      if (input.column !== undefined) updates.column = input.column
      if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder
      if (input.useWorktree !== undefined) updates.useWorktree = input.useWorktree
      getDb()
        .update(schema.kanbanCards)
        .set(updates)
        .where(eq(schema.kanbanCards.id, input.id))
        .run()
      return { ok: true }
    }),

  remove: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    getDb().delete(schema.kanbanCards).where(eq(schema.kanbanCards.id, input.id)).run()
    return { ok: true }
  }),

  /** Create a chat for the card and send its prompt to the agent. */
  dispatch: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const db = getDb()
    const card = db
      .select()
      .from(schema.kanbanCards)
      .where(eq(schema.kanbanCards.id, input.id))
      .get()
    if (!card) throw new Error('Card not found')
    if (card.chatId) throw new Error('Card was already dispatched')

    const chat = await createChatWithSubchat({
      projectId: card.projectId,
      title: card.title,
      useWorktree: card.useWorktree
    })
    db.update(schema.kanbanCards)
      .set({ chatId: chat.id, updatedAt: Date.now() })
      .where(eq(schema.kanbanCards.id, card.id))
      .run()
    // Send after the card is linked so the board reflects the dispatch even
    // if the prompt errors; live status comes from the status subscription.
    await agentSessionManager.sendOrQueue(chat.subchats[0].id, card.prompt)
    return { chatId: chat.id }
  })
})
