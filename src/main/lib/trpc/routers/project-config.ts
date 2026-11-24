/**
 * Per-project .mastracode configuration: hooks.json, custom .md commands,
 * custom subagents, agent-instructions.md, database.json resourceId, and
 * live plugin info. (mcp.json is handled by the existing mcp router with
 * projectPath.)
 */
import nodePath from 'node:path'
import { shell } from 'electron'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { agentSessionManager } from '../../agent/agent-session-manager'
import {
  createCommandFile,
  deleteCommandFile,
  listCommandFiles,
  readCommandFile,
  writeCommandFile
} from '../../mastra-config/commands-fs'
import {
  createAgentFile,
  deleteAgentFile,
  listAgentFiles,
  readAgentFile,
  writeAgentFile
} from '../../mastra-config/agents-fs'
import { DEFAULT_AGENTS, installDefaultAgents } from '../../mastra-config/default-agents'
import { readDatabaseJson, writeResourceId } from '../../mastra-config/database-json'
import { readInstructions, writeInstructions } from '../../mastra-config/agent-instructions'
import { HOOK_EVENTS, readHooksJson, writeHooksJson } from '../../mastra-config/hooks-json'
import { getDb, schema } from '../../db'
import { isSetupTrusted, trustSetupCommands } from '../../db/project-settings'
import { invalidCopyPatterns } from '../../git/copy-files'
import { worktreeConfigHash } from '../../git/setup-hash'
import { readWorktreeConfig, writeWorktreeConfig } from '../../git/worktree'
import { cleanList, isWorktreeConfigEmpty } from '../../git/worktree-config'
import { assertKnownRoot } from '../../known-roots'
import { publicProcedure, router } from '../trpc'

const scopeInput = z.object({ projectPath: z.string().optional() })

const OPENABLE_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.txt'])

/** The project row id for a project root path (setup-command trust is per project). */
function projectIdForPath(projectPath: string): string | null {
  const row = getDb()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.path, projectPath))
    .get()
  return row?.id ?? null
}

const agentScopeInput = z.object({
  scope: z.enum(['global', 'project']),
  projectPath: z.string().optional()
})

/** Project scope requires a path; global scope ignores it. */
function agentScopePath(input: z.infer<typeof agentScopeInput>): string | undefined {
  if (input.scope === 'global') return undefined
  if (!input.projectPath) throw new Error('projectPath is required for project-scoped agents')
  return input.projectPath
}

/** Editor saves/deletes take effect at host boot — restart the affected hosts. */
function restartForAgentScope(input: z.infer<typeof agentScopeInput>): void {
  if (input.scope === 'project' && input.projectPath) {
    agentSessionManager.restartByProject(input.projectPath)
  } else {
    agentSessionManager.restartAll()
  }
}

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

  // ---- custom subagents (.mastracode/agents/*.md) --------------------------
  agentsList: publicProcedure.input(agentScopeInput).query(async ({ input }) => {
    return listAgentFiles(agentScopePath(input))
  }),

  agentRead: publicProcedure
    .input(agentScopeInput.extend({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      return readAgentFile(agentScopePath(input), input.id)
    }),

  agentWrite: publicProcedure
    .input(
      agentScopeInput.extend({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        instructions: z.string(),
        model: z.string().optional(),
        maxSteps: z.number().int().positive().optional(),
        forked: z.boolean().optional()
      })
    )
    .mutation(async ({ input }) => {
      await writeAgentFile(agentScopePath(input), input.id, {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        model: input.model,
        maxSteps: input.maxSteps,
        forked: input.forked
      })
      restartForAgentScope(input)
      return { ok: true }
    }),

  agentCreate: publicProcedure
    .input(agentScopeInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // No restart: the template isn't useful until the user saves real fields.
      return createAgentFile(agentScopePath(input), input.id)
    }),

  agentDelete: publicProcedure
    .input(agentScopeInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await deleteAgentFile(agentScopePath(input), input.id)
      restartForAgentScope(input)
      return { ok: true }
    }),

  /** The built-in defaults catalog (ids + display metadata, no bodies). */
  agentDefaultsCatalog: publicProcedure.query(() => {
    return DEFAULT_AGENTS.map(({ id, group, data }) => ({
      id,
      group,
      name: data.name,
      description: data.description
    }))
  }),

  /** Install selected defaults; existing files are skipped, never overwritten. */
  agentsInstallDefaults: publicProcedure
    .input(agentScopeInput.extend({ ids: z.array(z.string().min(1)).min(1) }))
    .mutation(async ({ input }) => {
      const result = await installDefaultAgents(agentScopePath(input), input.ids)
      if (result.installed.length > 0) restartForAgentScope(input)
      return result
    }),

  openInEditor: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // shell.openPath launches whatever the OS associates with the file, so
      // only plain config/text files may be opened — never apps or scripts.
      if (!OPENABLE_EXTENSIONS.has(nodePath.extname(input.path).toLowerCase())) {
        throw new Error('Only markdown, JSON, YAML and text files can be opened')
      }
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

  // ---- worktree setup commands (.yardarm/worktree.json) ---------------------
  /**
   * The worktree lifecycle config in .yardarm/worktree.json: setup commands
   * run in every new worktree, glob patterns of untracked files copied into
   * it, and teardown commands run before it is removed.
   */
  worktreeSetupGet: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ input }) => {
      const config = await readWorktreeConfig(assertKnownRoot(input.projectPath))
      const projectId = projectIdForPath(input.projectPath)
      // Nothing runs or is copied until approved; a change made outside the
      // app (pull, agent edit) shows up here as untrusted.
      const trusted =
        isWorktreeConfigEmpty(config) || (projectId !== null && isSetupTrusted(projectId, config))
      return {
        commands: config.setup,
        copyFiles: config.copyFiles,
        teardown: config.teardown,
        trusted
      }
    }),

  /**
   * Persist the config (saving it from the app approves it). A list left out
   * of the input keeps its current value in the file.
   */
  worktreeSetupSet: publicProcedure
    .input(
      z.object({
        projectPath: z.string(),
        commands: z.array(z.string()),
        copyFiles: z.array(z.string()).optional(),
        teardown: z.array(z.string()).optional()
      })
    )
    .mutation(async ({ input }) => {
      const projectPath = assertKnownRoot(input.projectPath)
      const current = await readWorktreeConfig(projectPath)
      const next = {
        setup: cleanList(input.commands),
        copyFiles: input.copyFiles ? cleanList(input.copyFiles) : current.copyFiles,
        teardown: input.teardown ? cleanList(input.teardown) : current.teardown
      }
      if (input.copyFiles) {
        const invalid = invalidCopyPatterns(next.copyFiles)
        if (invalid.length > 0) {
          throw new Error(
            `Copy patterns must be relative paths inside the project (no leading "/", "~", ".." or backslashes): ${invalid.join(', ')}`
          )
        }
      }
      await writeWorktreeConfig(projectPath, next)
      const projectId = projectIdForPath(input.projectPath)
      if (projectId) trustSetupCommands(projectId, next)
      return { ok: true }
    }),

  /**
   * Approve a config that changed outside the app. The lists are what the
   * user reviewed; they must still match the repo file.
   */
  worktreeSetupApprove: publicProcedure
    .input(
      z.object({
        projectPath: z.string(),
        commands: z.array(z.string()),
        copyFiles: z.array(z.string()).default([]),
        teardown: z.array(z.string()).default([])
      })
    )
    .mutation(async ({ input }) => {
      const projectId = projectIdForPath(input.projectPath)
      if (!projectId) throw new Error('Project not found')
      const current = await readWorktreeConfig(input.projectPath)
      const shown = { setup: input.commands, copyFiles: input.copyFiles, teardown: input.teardown }
      if (worktreeConfigHash(current) !== worktreeConfigHash(shown)) {
        throw new Error('The worktree setup changed — review it again before approving.')
      }
      trustSetupCommands(projectId, current)
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

  /** Scaffold a new plugin directory (chat-independent — runs on the utility host). */
  pluginScaffold: publicProcedure
    .input(
      z.object({
        targetDir: z.string().min(1),
        id: z.string().optional(),
        name: z.string().optional(),
        projectRoot: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.scaffoldPlugin(input)
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
    }),

  // ---- workflows -------------------------------------------------------------
  /** Chat-built workflows stored by the SDK (shared storage, listed via the chat's host). */
  workflowsList: publicProcedure
    .input(z.object({ subchatId: z.string() }))
    .query(async ({ input }) => {
      return agentSessionManager.workflowsList(input.subchatId)
    }),

  /** Run a stored workflow to completion; long-running by design. */
  workflowRun: publicProcedure
    .input(
      z.object({
        subchatId: z.string(),
        workflowId: z.string().min(1),
        inputJson: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      return agentSessionManager.workflowRun(input.subchatId, input.workflowId, input.inputJson)
    }),

  workflowDelete: publicProcedure
    .input(z.object({ subchatId: z.string(), workflowId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await agentSessionManager.workflowDelete(input.subchatId, input.workflowId)
      return { ok: true }
    }),

  /** Read a stored workflow's editable definition (pretty-printed JSON). */
  workflowGet: publicProcedure
    .input(z.object({ subchatId: z.string(), workflowId: z.string().min(1) }))
    .query(async ({ input }) => {
      return agentSessionManager.workflowGet(input.subchatId, input.workflowId)
    }),

  /** Validated upsert of an edited definition — same path as the agent's save-workflow tool. */
  workflowSave: publicProcedure
    .input(z.object({ subchatId: z.string(), definitionJson: z.string().min(2) }))
    .mutation(async ({ input }) => {
      return agentSessionManager.workflowSave(input.subchatId, input.definitionJson)
    })
})
