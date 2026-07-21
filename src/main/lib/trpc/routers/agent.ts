import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { captureCheckpoint } from '../../git/ops'
import { readSettings } from '../../mastra-config/settings-json'
import { MODES, type AgentUIEvent, type SubchatStatusInfo } from '../../../../shared/ui-message'
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
      // Always seed meta: DB row as the base, live host values (minus undefined
      // keys, which would clobber the base on spread) on top.
      const live = agentSessionManager.meta(subchatId) ?? {}
      const defined = Object.fromEntries(Object.entries(live).filter(([, v]) => v !== undefined))
      emit.next({
        type: 'session-meta',
        meta: { ...agentSessionManager.persistedMeta(subchatId), ...defined }
      })
      const tasks = agentSessionManager.tasks(subchatId)
      if (tasks.length > 0) emit.next({ type: 'task-list', tasks })
      if (agentSessionManager.isRunning(subchatId)) emit.next({ type: 'run-started' })
      for (const ev of agentSessionManager.pendingApprovals(subchatId)) emit.next(ev)
      const queued = agentSessionManager.queuedPrompts(subchatId)
      if (queued.length > 0) emit.next({ type: 'queued-prompts', items: queued })

      const off = agentSessionManager.onEvents(subchatId, (ev) => emit.next(ev))
      return off
    })
  }),

  /** Cross-chat live status: seeds a snapshot of all hosts, then streams changes. */
  statusAll: publicProcedure.subscription(() => {
    return observable<SubchatStatusInfo>((emit) => {
      for (const info of agentSessionManager.statusSnapshot()) emit.next(info)
      return agentSessionManager.onStatus((info) => emit.next(info))
    })
  }),

  send: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        content: z.string().min(1),
        files: z
          .array(
            z.object({
              data: z.string().min(1),
              mediaType: z.string().min(1),
              filename: z.string().optional()
            })
          )
          .optional()
      })
    )
    .mutation(async ({ input }) => {
      // Queues behind an active run (dismissable, flushed FIFO on run end);
      // sends immediately when idle. Checkpoint capture happens at send time
      // inside the manager.
      await agentSessionManager.sendOrQueue(input.subchatId, input.content, input.files)
      return { ok: true }
    }),

  /** Remove a queued prompt before it sends. */
  dismissQueued: publicProcedure
    .input(z.object({ subchatId: z.string(), id: z.string() }))
    .mutation(({ input }) => {
      agentSessionManager.dismissQueuedPrompt(input.subchatId, input.id)
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
      await agentSessionManager.respondSuspension(
        input.subchatId,
        input.toolCallId,
        input.resumeData
      )
      return { ok: true }
    }),

  abort: publicProcedure.input(z.object({ subchatId: z.string() })).mutation(({ input }) => {
    agentSessionManager.abort(input.subchatId)
    return { ok: true }
  }),

  setMode: publicProcedure
    .input(z.object({ subchatId: z.string(), modeId: z.enum(MODES) }))
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
    }),

  newThread: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .mutation(async ({ input }) => {
      return agentSessionManager.newThread(input.subchatId)
    }),

  listThreads: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .query(async ({ input }) => {
      return agentSessionManager.listThreads(input.subchatId)
    }),

  switchThread: publicProcedure
    .input(z.object({ subchatId: z.string(), threadId: z.string() }))
    .mutation(async ({ input }) => {
      return agentSessionManager.switchThread(input.subchatId, input.threadId)
    }),

  /** Renames the subchat's active thread (SDK constraint). */
  renameThread: publicProcedure
    .input(z.object({ subchatId: z.string(), title: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await agentSessionManager.renameThread(input.subchatId, input.title)
      return { ok: true }
    }),

  cloneThread: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        sourceThreadId: z.string().optional(),
        title: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.cloneThread(input.subchatId, input.sourceThreadId, input.title)
    }),

  deleteThread: publicProcedure
    .input(z.object({ subchatId: z.string(), threadId: z.string() }))
    .mutation(async ({ input }) => {
      return agentSessionManager.deleteThread(input.subchatId, input.threadId)
    }),

  /** The active thread's goal objective, or null. */
  goalGet: publicProcedure.input(z.object({ subchatId: z.string() })).query(async ({ input }) => {
    return agentSessionManager.goalGet(input.subchatId)
  }),

  /** Set a goal. Judge model / max turns default from global settings. */
  goalSet: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        objective: z.string().min(1),
        judgeModelId: z.string().optional(),
        maxRuns: z.number().int().positive().optional()
      })
    )
    .mutation(async ({ input }) => {
      let judgeModelId = input.judgeModelId
      let maxRuns = input.maxRuns
      if (!judgeModelId || maxRuns === undefined) {
        const settings = await readSettings()
        judgeModelId = judgeModelId ?? settings.models?.goalJudgeModel ?? undefined
        maxRuns = maxRuns ?? settings.models?.goalMaxTurns ?? undefined
      }
      // Without a judge model the SDK treats the goal as a no-op.
      if (!judgeModelId) {
        const meta = agentSessionManager.meta(input.subchatId)
        judgeModelId = meta?.modelId
      }
      return agentSessionManager.goalSet(input.subchatId, input.objective, judgeModelId, maxRuns)
    }),

  goalClear: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .mutation(async ({ input }) => {
      await agentSessionManager.goalClear(input.subchatId)
      return { ok: true }
    }),

  /** Pause/resume the goal or adjust its judge model / max runs. */
  goalUpdate: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        judgeModelId: z.string().optional(),
        maxRuns: z.number().int().positive().optional(),
        status: z.enum(['active', 'paused']).optional()
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.goalUpdate(input.subchatId, {
        judgeModelId: input.judgeModelId,
        maxRuns: input.maxRuns,
        status: input.status
      })
    }),

  /** Observational Memory runtime config from live session state. */
  omGet: publicProcedure.input(z.object({ subchatId: z.string() })).query(async ({ input }) => {
    return agentSessionManager.omGet(input.subchatId)
  }),

  omSet: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        patch: z.object({
          observerModelId: z.string().optional(),
          reflectorModelId: z.string().optional(),
          // Min 1000: the SDK sizes its OM buffer at 20% of the threshold (with a
          // 2000-token activation window), so tiny values break Memory validation.
          observationThreshold: z.number().int().min(1000).optional(),
          reflectionThreshold: z.number().int().min(1000).optional(),
          cavemanObservations: z.boolean().optional()
        })
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.omSet(input.subchatId, input.patch)
    }),

  /** Tool-permission rules (persisted in session state) + session grants. */
  getPermissions: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .query(async ({ input }) => {
      return agentSessionManager.getPermissions(input.subchatId)
    }),

  setPermission: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        scope: z.enum(['tool', 'category']),
        name: z.string().min(1),
        policy: z.enum(['allow', 'ask', 'deny'])
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.setPermission(
        input.subchatId,
        input.scope,
        input.name,
        input.policy
      )
    }),

  /** Session-state keys surfaced to the UI (notifications, smartEditing, sandbox paths). */
  stateGet: publicProcedure.input(z.object({ subchatId: z.string() })).query(async ({ input }) => {
    return agentSessionManager.stateGet(input.subchatId)
  }),

  stateSet: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        patch: z.object({
          notifications: z.enum(['bell', 'system', 'both', 'off']).optional(),
          smartEditing: z.boolean().optional(),
          sandboxAllowedPaths: z.array(z.string()).optional()
        })
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.stateSet(input.subchatId, input.patch)
    }),

  /** User-invocable workspace skills (SKILL.md) in this subchat's worktree. */
  listSkills: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .query(async ({ input }) => {
      return agentSessionManager.listSkills(input.subchatId)
    }),

  /** Activate a skill and send it as a prompt. */
  runSkill: publicProcedure
    .input(z.object({ subchatId: z.string(), name: z.string().min(1), args: z.string() }))
    .mutation(async ({ input }) => {
      const cwd = subchatCwd(input.subchatId)
      const checkpointRef = cwd ? await captureCheckpoint(cwd) : null
      await agentSessionManager.runSkill(
        input.subchatId,
        input.name,
        input.args,
        checkpointRef ?? undefined
      )
      return { ok: true }
    }),

  /** Custom .md slash commands available in this subchat's worktree. */
  listCommands: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .query(async ({ input }) => {
      return agentSessionManager.listCommands(input.subchatId)
    }),

  /** Expand a custom command and send it as a prompt. */
  runCommand: publicProcedure
    .input(z.object({ subchatId: z.string(), name: z.string().min(1), args: z.string() }))
    .mutation(async ({ input }) => {
      const cwd = subchatCwd(input.subchatId)
      const checkpointRef = cwd ? await captureCheckpoint(cwd) : null
      await agentSessionManager.runCommand(
        input.subchatId,
        input.name,
        input.args,
        checkpointRef ?? undefined
      )
      return { ok: true }
    })
})
