import { z } from 'zod'
import { observable } from '@trpc/server/observable'
import { readMcpJson, writeMcpServers, type McpServerConfig } from '../../mastra-config/mcp-json'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { publicProcedure, router } from '../trpc'
import type { McpAuthUrlEvent } from '../../../../shared/ipc-types'

const serverNameInput = z.object({ subchatId: z.string().min(1), serverName: z.string().min(1) })

const serverConfigSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional()
  })
  .passthrough()

export const mcpRouter = router({
  get: publicProcedure
    .input(z.object({ projectPath: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const json = await readMcpJson(input?.projectPath)
      return json.mcpServers ?? {}
    }),

  set: publicProcedure
    .input(
      z.object({
        servers: z.record(z.string(), serverConfigSchema),
        projectPath: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      await writeMcpServers(input.servers as Record<string, McpServerConfig>, input.projectPath)
      // Hosts read mcp.json at boot — restart so changes take effect.
      // Project-scoped edits only affect that project's hosts.
      if (input.projectPath) agentSessionManager.restartByProject(input.projectPath)
      else agentSessionManager.restartAll()
      return { ok: true }
    }),

  /** Live per-server connection status from the subchat's agent host. */
  status: publicProcedure
    .input(z.object({ subchatId: z.string().min(1) }))
    .query(({ input }) => agentSessionManager.mcpStatus(input.subchatId)),

  /**
   * Run the OAuth consent flow for a needsAuth server. The SDK resolves
   * with a status carrying error/cancelled instead of rejecting — the
   * returned McpServerStatusInfo is the source of truth for the outcome.
   */
  authenticate: publicProcedure
    .input(serverNameInput)
    .mutation(({ input }) =>
      agentSessionManager.mcpAuthenticate(input.subchatId, input.serverName)
    ),

  cancelAuth: publicProcedure
    .input(serverNameInput)
    .mutation(({ input }) => agentSessionManager.mcpCancelAuth(input.subchatId, input.serverName)),

  reconnect: publicProcedure
    .input(serverNameInput)
    .mutation(({ input }) => agentSessionManager.mcpReconnect(input.subchatId, input.serverName)),

  /** Auth URLs of in-flight MCP OAuth flows (fallback link — main already opened the browser). */
  onAuthUrl: publicProcedure.subscription(() => {
    return observable<McpAuthUrlEvent>((emit) => {
      return agentSessionManager.onMcpAuthUrl((ev) => emit.next(ev))
    })
  })
})
