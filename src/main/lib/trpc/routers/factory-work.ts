/**
 * Factory work-client router — the native UI over a running Factory server's
 * board APIs (projects, boards, work items, runs, decisions, attention,
 * intake). All HTTP rides the `persist:factory` webview session via
 * lib/factory/factory-client; identity/idempotency fields (requestId,
 * sessionId, kickoffKey) are minted here in the main process, never in the
 * renderer. `FactoryApiError` codes are prefixed into the thrown message as
 * `[code] ...` so the renderer can branch (auth_required, server_stopped,
 * stale, ...) without a custom error shape.
 */
import { z } from 'zod'
import {
  FACTORY_ATTENTION_KINDS,
  FACTORY_DECISION_STATUSES
} from '../../../../shared/factory-work-types'
import { buildStartRunBody, buildTransitionBody, FactoryApiError } from '../../factory/factory-api'
import {
  actOnAttention,
  actOnDecision,
  attentionReadAll,
  createProject,
  createWorkItem,
  fetchAttention,
  fetchBoards,
  fetchDecisions,
  fetchIntakeBindings,
  fetchIntakeItems,
  fetchIntakeSources,
  fetchMe,
  fetchProjects,
  fetchWorkItems,
  setIntakeBinding,
  startRun,
  transitionWorkItem
} from '../../factory/factory-client'
import { ptyManager } from '../../terminal/pty-manager'
import { publicProcedure, router } from '../trpc'

const SERVER_ID = 'factory-server'

/** Rethrow FactoryApiError as `[code] message` so the renderer can branch. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof FactoryApiError) throw new Error(`[${err.code}] ${err.message}`)
    throw err
  }
}

const dirInput = z.object({ dir: z.string().min(1) })
const projectInput = dirInput.extend({ projectId: z.string().min(1) })

const externalSourceSchema = z.object({
  integrationId: z.string().optional(),
  type: z.string(),
  externalId: z.string(),
  url: z.string().optional()
})

const attentionKindSchema = z.enum(FACTORY_ATTENTION_KINDS)
const decisionStatusSchema = z.enum(FACTORY_DECISION_STATUSES)

export const factoryWorkRouter = router({
  /** Auth probe: who is signed into the `persist:factory` session, if anyone. */
  me: publicProcedure.input(dirInput).query(({ input }) => run(() => fetchMe(input.dir))),

  projects: publicProcedure
    .input(dirInput)
    .query(({ input }) => run(() => fetchProjects(input.dir))),

  createProject: publicProcedure
    .input(
      dirInput.extend({ name: z.string().min(1).max(200), description: z.string().optional() })
    )
    .mutation(({ input }) =>
      run(() => createProject(input.dir, { name: input.name, description: input.description }))
    ),

  boards: publicProcedure
    .input(projectInput)
    .query(({ input }) => run(() => fetchBoards(input.dir, input.projectId))),

  workItems: publicProcedure
    .input(projectInput)
    .query(({ input }) => run(() => fetchWorkItems(input.dir, input.projectId))),

  createWorkItem: publicProcedure
    .input(
      projectInput.extend({
        title: z.string().min(1).max(500),
        board: z.string().optional(),
        externalSource: externalSourceSchema.optional(),
        parentWorkItemId: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional()
      })
    )
    .mutation(({ input }) =>
      run(() =>
        createWorkItem(input.dir, input.projectId, {
          title: input.title,
          board: input.board,
          externalSource: input.externalSource,
          parentWorkItemId: input.parentWorkItemId,
          metadata: input.metadata
        })
      )
    ),

  /** Board drag: main mints requestId + cause; 409 [stale] means refresh. */
  transition: publicProcedure
    .input(
      projectInput.extend({
        workItemId: z.string().min(1),
        board: z.string().min(1),
        stage: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
        reenter: z.boolean().optional()
      })
    )
    .mutation(({ input }) =>
      run(() =>
        transitionWorkItem(
          input.dir,
          input.projectId,
          input.workItemId,
          buildTransitionBody({
            board: input.board,
            stage: input.stage,
            expectedRevision: input.expectedRevision,
            reenter: input.reenter
          })
        )
      )
    ),

  /**
   * Start an agent run against a card. The current card is re-fetched here so
   * the kickoff input echoes the server's own create-shape; sessionId and
   * kickoffKey are fresh uuids per gesture.
   */
  startRun: publicProcedure
    .input(projectInput.extend({ workItemId: z.string().min(1), role: z.string().min(1).max(32) }))
    .mutation(({ input }) =>
      run(async () => {
        const { workItems } = await fetchWorkItems(input.dir, input.projectId)
        const item = (workItems ?? []).find((w) => w.id === input.workItemId)
        if (!item) throw new FactoryApiError(404, 'work_item_not_found', 'Card no longer exists')
        await startRun(input.dir, input.projectId, buildStartRunBody(item, input.role))
        return { ok: true }
      })
    ),

  decisions: publicProcedure
    .input(
      projectInput.extend({
        statuses: z.array(decisionStatusSchema).optional(),
        before: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(({ input }) =>
      run(() =>
        fetchDecisions(input.dir, input.projectId, {
          statuses: input.statuses,
          before: input.before,
          limit: input.limit
        })
      )
    ),

  decisionAction: publicProcedure
    .input(
      projectInput.extend({
        decisionId: z.string().min(1),
        action: z.enum(['approve', 'dismiss', 'retry'])
      })
    )
    .mutation(({ input }) =>
      run(() => actOnDecision(input.dir, input.projectId, input.decisionId, input.action))
    ),

  attention: publicProcedure
    .input(
      projectInput.extend({
        view: z.enum(['open', 'unread', 'archived']).optional(),
        kinds: z.array(attentionKindSchema).optional(),
        before: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        search: z.string().optional()
      })
    )
    .query(({ input }) =>
      run(() =>
        fetchAttention(input.dir, input.projectId, {
          view: input.view,
          kinds: input.kinds,
          before: input.before,
          limit: input.limit,
          search: input.search
        })
      )
    ),

  attentionAction: publicProcedure
    .input(
      projectInput.extend({
        kind: attentionKindSchema,
        sourceId: z.string().min(1),
        occurrence: z.number().int().nonnegative(),
        action: z.enum(['read', 'archive', 'restore'])
      })
    )
    .mutation(({ input }) =>
      run(async () => {
        await actOnAttention(
          input.dir,
          input.projectId,
          input.kind,
          input.sourceId,
          input.occurrence,
          input.action
        )
        return { ok: true }
      })
    ),

  attentionReadAll: publicProcedure.input(projectInput).mutation(({ input }) =>
    run(async () => {
      await attentionReadAll(input.dir, input.projectId)
      return { ok: true }
    })
  ),

  /**
   * App-level unread badge: sums unread counts across every project's
   * attention kind summary. Short-circuits without any network I/O when the
   * server pty is down (or the session isn't signed in / has no org), so the
   * idle poll costs nothing and never surfaces errors.
   */
  attentionSummary: publicProcedure
    .input(dirInput)
    .query(async ({ input }): Promise<{ running: boolean; unread: number }> => {
      if (!ptyManager.exists(SERVER_ID)) return { running: false, unread: 0 }
      try {
        const projects = await fetchProjects(input.dir)
        let unread = 0
        for (const project of projects.slice(0, 10)) {
          const res = await fetchAttention(input.dir, project.id, { view: 'unread', limit: 1 })
          for (const summary of Object.values(res.kinds ?? {})) {
            unread += typeof summary?.unread === 'number' ? summary.unread : 0
          }
        }
        return { running: true, unread }
      } catch {
        return { running: true, unread: 0 }
      }
    }),

  intakeItems: publicProcedure
    .input(dirInput.extend({ cursor: z.string().optional() }))
    .query(({ input }) => run(() => fetchIntakeItems(input.dir, input.cursor))),

  intakeSources: publicProcedure
    .input(dirInput)
    .query(({ input }) => run(() => fetchIntakeSources(input.dir))),

  intakeBindings: publicProcedure
    .input(dirInput)
    .query(({ input }) => run(() => fetchIntakeBindings(input.dir))),

  setIntakeBinding: publicProcedure
    .input(
      dirInput.extend({
        integrationId: z.string().min(1),
        sourceId: z.string().min(1),
        factoryProjectId: z.string().nullable(),
        board: z.string().optional()
      })
    )
    .mutation(({ input }) =>
      run(() =>
        setIntakeBinding(input.dir, {
          integrationId: input.integrationId,
          sourceId: input.sourceId,
          factoryProjectId: input.factoryProjectId,
          board: input.board
        })
      )
    )
})
