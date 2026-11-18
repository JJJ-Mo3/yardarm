/**
 * tRPC router for remote messaging integrations (Slack / Discord): non-secret
 * config, write-only secrets (renderer only ever sees booleans), live
 * connection status, and binding management. Config/secret mutations restart
 * only the affected platform adapters.
 */
import { observable } from '@trpc/server/observable'
import { z } from 'zod'
import { publicProcedure, router } from '../trpc'
import {
  integrationsManager,
  readIntegrationsConfig,
  writeIntegrationsConfig
} from '../../integrations/manager'
import { clearSecret, secretsState, setSecret } from '../../integrations/secrets'
import { deleteBindingById, listBindingsInfo } from '../../integrations/bindings'
import type { IntegrationStatusMap } from '../../../../shared/integrations'

const platformSchema = z.enum(['slack', 'discord'])

const platformConfigSchema = z.object({
  enabled: z.boolean(),
  allowedUserIds: z.array(z.string())
})

const secretKeySchema = z.enum(['slackAppToken', 'slackBotToken', 'discordBotToken'])

const SECRET_PLATFORM = {
  slackAppToken: 'slack',
  slackBotToken: 'slack',
  discordBotToken: 'discord'
} as const

export const integrationsRouter = router({
  getConfig: publicProcedure.query(() => ({
    config: readIntegrationsConfig(),
    secrets: secretsState()
  })),

  setConfig: publicProcedure
    .input(z.object({ slack: platformConfigSchema, discord: platformConfigSchema }))
    .mutation(async ({ input }) => {
      const prev = readIntegrationsConfig()
      writeIntegrationsConfig(input)
      // Restart only platforms whose config actually changed.
      const changed = (['slack', 'discord'] as const).filter(
        (p) => JSON.stringify(prev[p]) !== JSON.stringify(input[p])
      )
      if (changed.length > 0) await integrationsManager.applyConfig(changed)
    }),

  setSecret: publicProcedure
    .input(z.object({ key: secretKeySchema, value: z.string() }))
    .mutation(async ({ input }) => {
      setSecret(input.key, input.value)
      await integrationsManager.applyConfig([SECRET_PLATFORM[input.key]])
    }),

  clearSecret: publicProcedure
    .input(z.object({ key: secretKeySchema }))
    .mutation(async ({ input }) => {
      clearSecret(input.key)
      await integrationsManager.applyConfig([SECRET_PLATFORM[input.key]])
    }),

  status: publicProcedure.query(() => integrationsManager.status()),

  onStatus: publicProcedure.subscription(() => {
    return observable<IntegrationStatusMap>((emit) => {
      emit.next(integrationsManager.status())
      return integrationsManager.onStatus((status) => emit.next(status))
    })
  }),

  listBindings: publicProcedure.query(() => listBindingsInfo()),

  deleteBinding: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    deleteBindingById(input.id)
    integrationsManager.notifyBindingsChanged()
  }),

  reconnect: publicProcedure
    .input(z.object({ platform: platformSchema }))
    .mutation(async ({ input }) => {
      await integrationsManager.applyConfig([input.platform])
    })
})
