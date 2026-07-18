/**
 * Global mastracode settings.json editing. Mutations report
 * `{ needsRestart: true }` — running agent hosts read settings at boot, so
 * the renderer batches edits and calls `applyRestart` once.
 */
import { z } from 'zod'
import { agentSessionManager } from '../../agent/agent-session-manager'
import {
  readSettings,
  removeCustomProvider,
  setGoalDefaults,
  setModeDefault,
  setOmDefaults,
  setSubagentModel,
  upsertCustomProvider
} from '../../mastra-config/settings-json'
import { publicProcedure, router } from '../trpc'

const NEEDS_RESTART = { needsRestart: true as const }

export const mastraSettingsRouter = router({
  get: publicProcedure.query(async () => {
    return readSettings()
  }),

  setModeDefault: publicProcedure
    .input(z.object({ mode: z.string().min(1), modelId: z.string().nullable() }))
    .mutation(async ({ input }) => {
      await setModeDefault(input.mode, input.modelId)
      return NEEDS_RESTART
    }),

  setSubagentModel: publicProcedure
    .input(z.object({ agentType: z.string().min(1), modelId: z.string().nullable() }))
    .mutation(async ({ input }) => {
      await setSubagentModel(input.agentType, input.modelId)
      return NEEDS_RESTART
    }),

  setGoalDefaults: publicProcedure
    .input(
      z.object({
        judgeModel: z.string().nullable().optional(),
        maxTurns: z.number().int().positive().nullable().optional()
      })
    )
    .mutation(async ({ input }) => {
      await setGoalDefaults(input)
      return NEEDS_RESTART
    }),

  setOmDefaults: publicProcedure
    .input(
      z.object({
        observerModelOverride: z.string().nullable().optional(),
        reflectorModelOverride: z.string().nullable().optional(),
        omObservationThreshold: z.number().positive().nullable().optional(),
        omReflectionThreshold: z.number().positive().nullable().optional(),
        omCavemanObservations: z.boolean().nullable().optional()
      })
    )
    .mutation(async ({ input }) => {
      await setOmDefaults(input)
      return NEEDS_RESTART
    }),

  upsertCustomProvider: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        url: z.string().min(1),
        apiKey: z.string().optional(),
        models: z.array(z.string().min(1))
      })
    )
    .mutation(async ({ input }) => {
      await upsertCustomProvider(input)
      return NEEDS_RESTART
    }),

  removeCustomProvider: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await removeCustomProvider(input.name)
      return NEEDS_RESTART
    }),

  /** Restart all agent hosts so settings.json edits take effect. */
  applyRestart: publicProcedure.mutation(() => {
    agentSessionManager.restartAll()
    return { ok: true }
  })
})
