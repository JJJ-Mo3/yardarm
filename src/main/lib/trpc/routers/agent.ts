import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { captureCheckpoint } from '../../git/ops'
import type { AgentUIEvent } from '../../../../shared/ui-message'
import { publicProcedure, router } from '../trpc'

function subchatCwd(subchatId: string): string | null {
  const db = getDb()
  const subchat = db.select().from(schema.subchats).where(eq(schema.subchats.id, subchatId)).get()
  if (!subchat) return null
  const chat = db.select().from(schema.chats).where(eq(schema.chats.id, subchat.chatId)).get()
  if (!chat) return null
  if (chat.worktreePath) return chat.worktreePath
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, chat.projectId))
    .get()
  return project?.path ?? null
}

export const agentRouter = router({
  /** Live event stream for one subchat. Seeds history + current state first. */
  stream: publicProcedure.input(z.object({ subchatId: z.string() })).subscription(({ input }) => {
    return observable<AgentUIEvent>((emit) => {
      const { subchatId } = input

      // Seed: full history, status, meta, and any pending gates.
      emit.next({ type: 'messages-reset', messages: agentSessionManager.loadMessages(subchatId) })
      emit.next({ type: 'status', status: agentSessionManager.status(subchatId) })
      const meta = agentSessionManager.meta(subchatId)
      if (meta) emit.next({ type: 'session-meta', meta })
      if (agentSessionManager.isRunning(subchatId)) emit.next({ type: 'run-started' })
      for (const ev of agentSessionManager.pendingApprovals(subchatId)) emit.next(ev)

      const off = agentSessionManager.onEvents(subchatId, (ev) => emit.next(ev))
      return off
    })
  }),

  send: publicProcedure
    .input(z.object({ subchatId: z.string(), content: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const cwd = subchatCwd(input.subchatId)
      const checkpointRef = cwd ? await captureCheckpoint(cwd) : null
      await agentSessionManager.sendMessage(input.subchatId, input.content, checkpointRef ?? undefined)
      return { ok: true }
    }),

  approve: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        toolCallId: z.string(),
        decision: z.enum(['approve', 'decline', 'always_allow_category']),
        feedback: z.string().optional(),
        alwaysAllowToolName: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      if (input.alwaysAllowToolName) {
        await agentSessionManager.alwaysAllowTool(input.subchatId, input.alwaysAllowToolName)
      }
      await agentSessionManager.approve(
        input.subchatId,
        input.toolCallId,
        input.decision,
        input.feedback
      )
      return { ok: true }
    }),

  respondSuspension: publicProcedure
    .input(z.object({ subchatId: z.string(), toolCallId: z.string(), resumeData: z.unknown() }))
    .mutation(async ({ input }) => {
      await agentSessionManager.respondSuspension(input.subchatId, input.toolCallId, input.resumeData)
      return { ok: true }
    }),

  abort: publicProcedure.input(z.object({ subchatId: z.string() })).mutation(({ input }) => {
    agentSessionManager.abort(input.subchatId)
    return { ok: true }
  }),

  setMode: publicProcedure
    .input(z.object({ subchatId: z.string(), modeId: z.string() }))
    .mutation(async ({ input }) => {
      await agentSessionManager.setMode(input.subchatId, input.modeId)
      return { ok: true }
    }),

  setModel: publicProcedure
    .input(z.object({ subchatId: z.string(), modelId: z.string() }))
    .mutation(async ({ input }) => {
      await agentSessionManager.setModel(input.subchatId, input.modelId)
      return { ok: true }
    }),

  setYolo: publicProcedure
    .input(z.object({ subchatId: z.string(), yolo: z.boolean() }))
    .mutation(async ({ input }) => {
      await agentSessionManager.setYolo(input.subchatId, input.yolo)
      return { ok: true }
    }),

  setThinking: publicProcedure
    .input(z.object({ subchatId: z.string(), level: z.string() }))
    .mutation(async ({ input }) => {
      await agentSessionManager.setThinking(input.subchatId, input.level)
      return { ok: true }
    }),

  start: publicProcedure.input(z.object({ subchatId: z.string() })).mutation(async ({ input }) => {
    await agentSessionManager.ensureHost(input.subchatId)
    return { ok: true }
  }),

  stop: publicProcedure.input(z.object({ subchatId: z.string() })).mutation(({ input }) => {
    agentSessionManager.stopHost(input.subchatId)
    return { ok: true }
  }),

  listModels: publicProcedure
    .input(z.object({ subchatId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return agentSessionManager.listModels(input?.subchatId)
    })
})
