import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import type { OAuthStatusEvent } from '../../../../shared/ipc-types'
import { publicProcedure, router } from '../trpc'

export const settingsRouter = router({
  get: publicProcedure.input(z.object({ key: z.string() })).query(({ input }) => {
    const row = getDb()
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, input.key))
      .get()
    return row ? (JSON.parse(row.value) as unknown) : null
  }),

  getAll: publicProcedure.query(() => {
    const rows = getDb().select().from(schema.appSettings).all()
    const out: Record<string, unknown> = {}
    for (const r of rows) out[r.key] = JSON.parse(r.value)
    return out
  }),

  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.unknown() }))
    .mutation(({ input }) => {
      const db = getDb()
      const value = JSON.stringify(input.value ?? null)
      const existing = db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, input.key))
        .get()
      if (existing) {
        db.update(schema.appSettings)
          .set({ value })
          .where(eq(schema.appSettings.key, input.key))
          .run()
      } else {
        db.insert(schema.appSettings).values({ key: input.key, value }).run()
      }
      return { ok: true }
    }),

  // Provider API keys — proxied to mastracode AuthStorage (~/.mastracode/auth.json)
  authList: publicProcedure.query(() => agentSessionManager.authList()),

  authSet: publicProcedure
    .input(z.object({ provider: z.string().min(1), apiKey: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await agentSessionManager.authSet(input.provider, input.apiKey)
      return { ok: true }
    }),

  authRemove: publicProcedure
    .input(z.object({ provider: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await agentSessionManager.authRemove(input.provider)
      return { ok: true }
    }),

  // OAuth login flows (Anthropic, OpenAI Codex, GitHub Copilot)
  oauthProviders: publicProcedure.query(() => agentSessionManager.oauthProviders()),

  oauthStart: publicProcedure
    .input(z.object({ provider: z.string().min(1), authMode: z.string().optional() }))
    .mutation(({ input }) => agentSessionManager.oauthStart(input.provider, input.authMode)),

  oauthPrompt: publicProcedure
    .input(z.object({ flowId: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      agentSessionManager.oauthPrompt(input.flowId, input.value)
      return { ok: true }
    }),

  oauthCancel: publicProcedure.input(z.object({ flowId: z.string() })).mutation(({ input }) => {
    agentSessionManager.oauthCancel(input.flowId)
    return { ok: true }
  }),

  oauthLogout: publicProcedure
    .input(z.object({ provider: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await agentSessionManager.oauthLogout(input.provider)
      return { ok: true }
    }),

  /** Live status events for all OAuth flows; filter by flowId in the client. */
  onOauthStatus: publicProcedure.subscription(() => {
    return observable<OAuthStatusEvent>((emit) => {
      return agentSessionManager.onOauthStatus((ev) => emit.next(ev))
    })
  })
})
