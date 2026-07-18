import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { captureCheckpoint } from '../../git/ops'
import { readSettings } from '../../mastra-config/settings-json'
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
      const tasks = agentSessionManager.tasks(subchatId)
      if (tasks.length > 0) emit.next({ type: 'task-list', tasks })
      if (agentSessionManager.isRunning(subchatId)) emit.next({ type: 'run-started' })
      for (const ev of agentSessionManager.pendingApprovals(subchatId)) emit.next(ev)

      const off = agentSessionManager.onEvents(subchatId, (ev) => emit.next(ev))
      return off
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
      const cwd = subchatCwd(input.subchatId)
      const checkpointRef = cwd ? await captureCheckpoint(cwd) : null
      await agentSessionManager.sendMessage(
        input.subchatId,
        input.content,
        checkpointRef ?? undefined,
        undefined,
        input.files
      )
      return { ok: true }
    }),

  /** Queue a message behind the active run (sends immediately when idle). */
  followUp: publicProcedure
    .input(z.object({ subchatId: z.string(), content: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const cwd = subchatCwd(input.subchatId)
      const checkpointRef = cwd ? await captureCheckpoint(cwd) : null
      await agentSessionManager.followUp(input.subchatId, input.content, checkpointRef ?? undefined)
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
          observationThreshold: z.number().positive().optional(),
          reflectionThreshold: z.number().positive().optional(),
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
