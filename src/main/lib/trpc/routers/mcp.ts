import { z } from 'zod'
import { readMcpJson, writeMcpServers, type McpServerConfig } from '../../mastra-config/mcp-json'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { publicProcedure, router } from '../trpc'

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
    })
})
