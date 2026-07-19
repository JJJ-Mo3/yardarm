/**
 * Global mastracode settings.json editing. Mutations report
 * `{ needsRestart: true }` — running agent hosts read settings at boot, so
 * the renderer batches edits and calls `applyRestart` once.
 */
import { z } from 'zod'
import { agentSessionManager } from '../../agent/agent-session-manager'
import {
  completeOnboarding,
  deleteCustomPack,
  readSettings,
  removeCustomProvider,
  saveCustomPack,
  setActiveModelPack,
  setBrowserSettings,
  setGoalDefaults,
  setModeDefault,
  setOmDefaults,
  setOmPack,
  setPreferences,
  setSubagentModel,
  setVoiceSettings,
  skipOnboarding,
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
        omModelOverride: z.string().nullable().optional(),
        omObservationThreshold: z.number().positive().nullable().optional(),
        omReflectionThreshold: z.number().positive().nullable().optional(),
        omCavemanObservations: z.boolean().nullable().optional()
      })
    )
    .mutation(async ({ input }) => {
      await setOmDefaults(input)
      return NEEDS_RESTART
    }),

  setPreferences: publicProcedure
    .input(
      z.object({
        yolo: z.boolean().nullable().optional(),
        theme: z.enum(['auto', 'dark', 'light']).optional(),
        thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh']).optional(),
        quietMode: z.boolean().optional(),
        quietModeMaxToolPreviewLines: z.number().int().min(0).optional()
      })
    )
    .mutation(async ({ input }) => {
      await setPreferences(input)
      return NEEDS_RESTART
    }),

  setVoiceSettings: publicProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        engine: z.enum(['macos-native', 'cloud']).optional(),
        provider: z.string().optional(),
        model: z.string().nullable().optional()
      })
    )
    .mutation(async ({ input }) => {
      await setVoiceSettings(input)
      return NEEDS_RESTART
    }),

  setBrowserSettings: publicProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        provider: z.enum(['stagehand', 'agent-browser']).optional(),
        headless: z.boolean().optional(),
        cdpUrl: z.string().nullable().optional(),
        profile: z.string().nullable().optional(),
        executablePath: z.string().nullable().optional(),
        scope: z.enum(['shared', 'thread']).nullable().optional(),
        stagehand: z
          .object({
            env: z.enum(['LOCAL', 'BROWSERBASE']).optional(),
            apiKey: z.string().nullable().optional(),
            projectId: z.string().nullable().optional(),
            preserveUserDataDir: z.boolean().optional()
          })
          .optional(),
        agentBrowser: z.object({ storageState: z.string().nullable().optional() }).optional()
      })
    )
    .mutation(async ({ input }) => {
      await setBrowserSettings(input)
      return NEEDS_RESTART
    }),

  /** Built-in + custom model packs and OM packs available to this user. */
  listPacks: publicProcedure.query(async () => {
    return agentSessionManager.listPacks()
  }),

  setActiveModelPack: publicProcedure
    .input(
      z.object({
        packId: z.string().nullable(),
        packModels: z.record(z.string(), z.string()).optional()
      })
    )
    .mutation(async ({ input }) => {
      await setActiveModelPack(input.packId, input.packModels)
      return NEEDS_RESTART
    }),

  setOmPack: publicProcedure
    .input(z.object({ packId: z.string().nullable() }))
    .mutation(async ({ input }) => {
      await setOmPack(input.packId)
      return NEEDS_RESTART
    }),

  saveCustomPack: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        models: z.record(z.string(), z.string().min(1))
      })
    )
    .mutation(async ({ input }) => {
      await saveCustomPack(input.name, input.models)
      return NEEDS_RESTART
    }),

  deleteCustomPack: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await deleteCustomPack(input.name)
      return NEEDS_RESTART
    }),

  /** The SDK's speech-to-text model registry (voice settings picker). */
  sttRegistry: publicProcedure.query(async () => {
    return agentSessionManager.sttRegistry()
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
  }),

  /**
   * Persist the first-run wizard's result and restart hosts so the chosen
   * packs/yolo take effect immediately (the wizard is a one-shot modal, so
   * no batching via applyRestart).
   */
  completeOnboarding: publicProcedure
    .input(
      z.object({
        modePackId: z.string().nullable(),
        modeModels: z.record(z.string(), z.string().min(1)).optional(),
        omPackId: z.string().nullable(),
        omModel: z.string().nullable().optional(),
        yolo: z.boolean()
      })
    )
    .mutation(async ({ input }) => {
      await completeOnboarding(input)
      agentSessionManager.restartAll()
      return { ok: true }
    }),

  /** Mark onboarding skipped; nothing hosts read changed, so no restart. */
  skipOnboarding: publicProcedure.mutation(async () => {
    await skipOnboarding()
    return { ok: true }
  })
})
