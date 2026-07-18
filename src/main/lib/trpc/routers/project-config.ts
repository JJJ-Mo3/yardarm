/**
 * Per-project .mastracode configuration: hooks.json, custom .md commands,
 * agent-instructions.md, database.json resourceId, and live plugin info.
 * (mcp.json is handled by the existing mcp router with projectPath.)
 */
import { shell } from 'electron'
import { z } from 'zod'
import { agentSessionManager } from '../../agent/agent-session-manager'
import {
  createCommandFile,
  deleteCommandFile,
  listCommandFiles,
  readCommandFile,
  writeCommandFile
} from '../../mastra-config/commands-fs'
import { readDatabaseJson, writeResourceId } from '../../mastra-config/database-json'
import { readInstructions, writeInstructions } from '../../mastra-config/agent-instructions'
import { HOOK_EVENTS, readHooksJson, writeHooksJson } from '../../mastra-config/hooks-json'
import { publicProcedure, router } from '../trpc'

const scopeInput = z.object({ projectPath: z.string().optional() })

export const projectConfigRouter = router({
  // ---- hooks.json --------------------------------------------------------
  hooksGet: publicProcedure.input(scopeInput).query(async ({ input }) => {
    const { path, config } = await readHooksJson(input.projectPath)
    return { path, config, validEvents: HOOK_EVENTS }
  }),

  /** Accepts the raw JSON text from the editor; validates before writing. */
  hooksSet: publicProcedure
    .input(z.object({ projectPath: z.string().optional(), json: z.string() }))
    .mutation(async ({ input }) => {
      let parsed: unknown
      try {
        parsed = input.json.trim() ? JSON.parse(input.json) : {}
      } catch (err) {
        throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
      }
      await writeHooksJson(parsed, input.projectPath)
      return { ok: true }
    }),

  /** Re-read hooks config in a live agent host (no restart needed). */
  hooksReload: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .mutation(async ({ input }) => {
      await agentSessionManager.reloadHooks(input.subchatId)
      return { ok: true }
    }),

  // ---- custom .md commands ----------------------------------------------
  commandsList: publicProcedure.input(scopeInput).query(async ({ input }) => {
    return listCommandFiles(input.projectPath)
  }),

  commandRead: publicProcedure
    .input(z.object({ projectPath: z.string().optional(), relPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return { content: await readCommandFile(input.projectPath, input.relPath) }
    }),

  commandWrite: publicProcedure
    .input(
      z.object({
        projectPath: z.string().optional(),
        relPath: z.string().min(1),
        content: z.string()
      })
    )
    .mutation(async ({ input }) => {
      await writeCommandFile(input.projectPath, input.relPath, input.content)
      return { ok: true }
    }),

  commandCreate: publicProcedure
    .input(
      z.object({
        projectPath: z.string().optional(),
        name: z
          .string()
          .min(1)
          .regex(/^[\w:-]+$/, 'Use letters, digits, - _ and : for namespacing')
      })
    )
    .mutation(async ({ input }) => {
      return createCommandFile(input.projectPath, input.name)
    }),

  commandDelete: publicProcedure
    .input(z.object({ projectPath: z.string().optional(), relPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await deleteCommandFile(input.projectPath, input.relPath)
      return { ok: true }
    }),

  openInEditor: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const error = await shell.openPath(input.path)
      if (error) throw new Error(error)
      return { ok: true }
    }),

  // ---- agent-instructions.md ----------------------------------------------
  instructionsGet: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ input }) => {
      return readInstructions(input.projectPath)
    }),

  /** Persist instructions; hosts read the file at boot, so restart the project's hosts. */
  instructionsSet: publicProcedure
    .input(z.object({ projectPath: z.string(), content: z.string() }))
    .mutation(async ({ input }) => {
      await writeInstructions(input.projectPath, input.content)
      agentSessionManager.restartByProject(input.projectPath)
      return { ok: true }
    }),

  // ---- database.json resourceId -------------------------------------------
  resourceIdGet: publicProcedure.input(scopeInput).query(async ({ input }) => {
    const { path, config } = await readDatabaseJson(input.projectPath)
    return { path, resourceId: config.resourceId ?? null }
  }),

  /** Persist the resourceId; hosts read it at boot, so restart the project's hosts. */
  resourceIdSet: publicProcedure
    .input(z.object({ projectPath: z.string(), resourceId: z.string().nullable() }))
    .mutation(async ({ input }) => {
      await writeResourceId(
        input.resourceId?.trim() ? input.resourceId.trim() : null,
        input.projectPath
      )
      agentSessionManager.restartByProject(input.projectPath)
      return { ok: true }
    }),

  /** The live session's effective resourceId (needs a running host). */
  resourceInfo: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .query(async ({ input }) => {
      return agentSessionManager.resourceInfo(input.subchatId)
    }),

  // ---- plugins / skills ----------------------------------------------------
  pluginsList: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .query(async ({ input }) => {
      return agentSessionManager.listPlugins(input.subchatId)
    }),

  pluginInstall: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        source: z.enum(['local', 'github']),
        pathOrUrl: z.string().min(1),
        scope: z.enum(['global', 'project'])
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.pluginInstall(
        input.subchatId,
        input.source,
        input.pathOrUrl,
        input.scope
      )
    }),

  pluginUninstall: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        pluginId: z.string().min(1),
        scope: z.enum(['global', 'project'])
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.pluginUninstall(input.subchatId, input.pluginId, input.scope)
    }),

  pluginSetEnabled: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        pluginId: z.string().min(1),
        scope: z.enum(['global', 'project']),
        enabled: z.boolean()
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.pluginSetEnabled(
        input.subchatId,
        input.pluginId,
        input.scope,
        input.enabled
      )
    }),

  pluginSetConfig: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        pluginId: z.string().min(1),
        scope: z.enum(['global', 'project']),
        key: z.string().min(1),
        value: z.union([z.string(), z.boolean()])
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.pluginSetConfig(
        input.subchatId,
        input.pluginId,
        input.scope,
        input.key,
        input.value
      )
    })
})
