/**
 * Scheduled runs CRUD. Rows live in the app
 * DB; the main-process scheduler (src/main/lib/schedules/scheduler.ts) fires
 * due rows while the app is open. Distinct from the SDK's experimental
 * in-agent schedule_* tools, which live inside one agent process.
 */
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  computeNextRunAt,
  parseCadence,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES
} from '@shared/schedules'
import { getDb, schema } from '../../db'
import { runScheduleNow } from '../../schedules/scheduler'
import { publicProcedure, router } from '../trpc'

const cadenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('interval'),
    minutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(MAX_INTERVAL_MINUTES)
  }),
  z.object({
    kind: z.literal('daily'),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  }),
  z.object({
    kind: z.literal('weekly'),
    day: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  })
])

export const schedulesRouter = router({
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
    return getDb()
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.projectId, input.projectId))
      .orderBy(desc(schema.schedules.createdAt))
      .all()
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(100),
        prompt: z.string().min(1),
        cadence: cadenceSchema,
        useWorktree: z.boolean().default(false)
      })
    )
    .mutation(({ input }) => {
      const now = Date.now()
      const row = {
        id: randomUUID(),
        projectId: input.projectId,
        name: input.name,
        prompt: input.prompt,
        cadence: JSON.stringify(input.cadence),
        enabled: true,
        chatId: null,
        useWorktree: input.useWorktree,
        lastRunAt: null,
        lastRunStatus: null,
        nextRunAt: computeNextRunAt(input.cadence, now),
        createdAt: now,
        updatedAt: now
      }
      getDb().insert(schema.schedules).values(row).run()
      return row
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100),
        prompt: z.string().min(1),
        cadence: cadenceSchema
      })
    )
    .mutation(({ input }) => {
      const db = getDb()
      const row = db.select().from(schema.schedules).where(eq(schema.schedules.id, input.id)).get()
      if (!row) throw new Error('Schedule not found')
      const now = Date.now()
      // A cadence change re-anchors the next occurrence to now.
      const cadenceJson = JSON.stringify(input.cadence)
      const nextRunAt =
        cadenceJson === row.cadence ? row.nextRunAt : computeNextRunAt(input.cadence, now)
      db.update(schema.schedules)
        .set({
          name: input.name,
          prompt: input.prompt,
          cadence: cadenceJson,
          nextRunAt,
          updatedAt: now
        })
        .where(eq(schema.schedules.id, input.id))
        .run()
      return { ok: true }
    }),

  setEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => {
      const db = getDb()
      const row = db.select().from(schema.schedules).where(eq(schema.schedules.id, input.id)).get()
      if (!row) throw new Error('Schedule not found')
      const now = Date.now()
      // Re-enabling re-anchors to now so a long-disabled schedule doesn't
      // fire immediately off a stale next_run_at.
      let nextRunAt = row.nextRunAt
      if (input.enabled) {
        const cadence = parseCadence(row.cadence)
        if (cadence) nextRunAt = computeNextRunAt(cadence, now)
      }
      db.update(schema.schedules)
        .set({ enabled: input.enabled, nextRunAt, updatedAt: now })
        .where(eq(schema.schedules.id, input.id))
        .run()
      return { ok: true }
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    getDb().delete(schema.schedules).where(eq(schema.schedules.id, input.id)).run()
    return { ok: true }
  }),

  /** Fire immediately (keeps the busy-skip guard; never moves next_run_at). */
  runNow: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await runScheduleNow(input.id)
    return { ok: true }
  })
})
