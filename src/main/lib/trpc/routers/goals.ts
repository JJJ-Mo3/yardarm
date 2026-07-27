/**
 * Goal evaluation history — persisted goal-judge verdicts (goal_evaluations
 * table, migration v7). History is chat-scoped: verdicts from every subchat
 * of the same chat are merged so forks/splits share one timeline.
 */
import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { getDb, schema } from '../../db'
import { publicProcedure, router } from '../trpc'

export const goalsRouter = router({
  /** Verdict history for the chat owning `subchatId`, newest first. */
  history: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        limit: z.number().int().positive().max(200).default(50)
      })
    )
    .query(({ input }) => {
      const db = getDb()
      const sub = db
        .select({ chatId: schema.subchats.chatId })
        .from(schema.subchats)
        .where(eq(schema.subchats.id, input.subchatId))
        .get()
      if (!sub) return []
      return db
        .select()
        .from(schema.goalEvaluations)
        .where(eq(schema.goalEvaluations.chatId, sub.chatId))
        .orderBy(desc(schema.goalEvaluations.createdAt))
        .limit(input.limit)
        .all()
    })
})
