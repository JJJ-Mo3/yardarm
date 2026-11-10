/**
 * Workflows CRUD + run: app-managed run-books over SDK-stored workflow
 * definitions. A workflow row holds Yardarm metadata (name, description,
 * default input, last-run state) around a definition id in the agent SDK's
 * own storage; runs execute through the active chat's agent host
 * (workflowRun) and post a transcript marker. Distinct from scheduled runs,
 * which may optionally fire a workflow instead of sending a prompt.
 */
import { randomUUID } from 'node:crypto'
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { publicProcedure, router } from '../trpc'

/** Optional JSON input: must parse to a non-null object when provided. */
const jsonObject = z
  .string()
  .max(20_000)
  .refine(
    (s) => {
      try {
        const v = JSON.parse(s)
        return typeof v === 'object' && v !== null && !Array.isArray(v)
      } catch {
        return false
      }
    },
    { message: 'Must be a JSON object' }
  )

export const workflowsRouter = router({
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
    return getDb()
      .select()
      .from(schema.workflows)
      .where(eq(schema.workflows.projectId, input.projectId))
      .orderBy(desc(schema.workflows.createdAt))
      .all()
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        definitionId: z.string().min(1),
        defaultInputJson: jsonObject.optional()
      })
    )
    .mutation(({ input }) => {
      const now = Date.now()
      const row = {
        id: randomUUID(),
        projectId: input.projectId,
        name: input.name,
        description: input.description?.trim() || null,
        definitionId: input.definitionId,
        defaultInputJson: input.defaultInputJson ?? null,
        lastRunAt: null,
        lastRunStatus: null,
        createdAt: now,
        updatedAt: now
      }
      getDb().insert(schema.workflows).values(row).run()
      return row
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        definitionId: z.string().min(1),
        defaultInputJson: jsonObject.optional()
      })
    )
    .mutation(({ input }) => {
      const db = getDb()
      const row = db.select().from(schema.workflows).where(eq(schema.workflows.id, input.id)).get()
      if (!row) throw new Error('Workflow not found')
      db.update(schema.workflows)
        .set({
          name: input.name,
          description: input.description?.trim() || null,
          definitionId: input.definitionId,
          defaultInputJson: input.defaultInputJson ?? null,
          updatedAt: Date.now()
        })
        .where(eq(schema.workflows.id, input.id))
        .run()
      return { ok: true }
    }),

  /** Delete the workflow; linked schedules are unlinked AND disabled (a
   * workflow-mode schedule has no prompt to fall back to). */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDb()
    db.delete(schema.workflows).where(eq(schema.workflows.id, input.id)).run()
    db.run(
      sql`UPDATE schedules SET workflow_id = NULL, enabled = 0 WHERE workflow_id = ${input.id}`
    )
    return { ok: true }
  }),

  /** Run the workflow's stored definition in the given chat's agent host
   * (awaits completion; the host enforces a 10-minute timeout). */
  run: publicProcedure
    .input(
      z.object({
        workflowId: z.string(),
        subchatId: z.string(),
        inputJson: jsonObject.optional()
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const wf = db
        .select()
        .from(schema.workflows)
        .where(eq(schema.workflows.id, input.workflowId))
        .get()
      if (!wf) throw new Error('Workflow not found')
      try {
        const result = await agentSessionManager.workflowRun(
          input.subchatId,
          wf.definitionId,
          input.inputJson ?? wf.defaultInputJson ?? undefined
        )
        db.update(schema.workflows)
          .set({
            lastRunAt: Date.now(),
            lastRunStatus: result.status === 'success' ? 'ok' : 'error',
            updatedAt: Date.now()
          })
          .where(eq(schema.workflows.id, wf.id))
          .run()
        agentSessionManager.postMarker(input.subchatId, `Workflow "${wf.name}": ${result.status}`)
        return result
      } catch (err) {
        db.update(schema.workflows)
          .set({ lastRunAt: Date.now(), lastRunStatus: 'error', updatedAt: Date.now() })
          .where(eq(schema.workflows.id, wf.id))
          .run()
        agentSessionManager.postMarker(
          input.subchatId,
          `Workflow "${wf.name}" failed: ${err instanceof Error ? err.message : String(err)}`
        )
        throw err
      }
    })
})
