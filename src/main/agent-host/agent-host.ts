/**
 * Agent host — runs inside an Electron utilityProcess, one per active chat.
 *
 * Boots mastracode with cwd pointed at the chat's git worktree and bridges
 * the interactive Session API to the main process over parentPort messages.
 * This is the single integration point with the mastracode SDK.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HostBootConfig, HostCommand, HostMessage } from '../../shared/ipc-types'

/**
 * Packaged builds: root of the vendored mastracode runtime
 * (Resources/agent-runtime). Unset in dev, where bare specifiers resolve
 * normally from the app's node_modules.
 */
let runtimeDir: string | undefined

/** Resolve an exports-map entry, preferring the import condition. */
function resolveExportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return resolveExportTarget(v.import) ?? resolveExportTarget(v.default)
  }
  return undefined
}

/**
 * Import a module from the vendored agent runtime when packaged. The app
 * bundle's own node_modules tree is mis-linked by electron-builder's pnpm
 * walker (wrong @ai-sdk/* versions nested together), so the packaged host
 * must load mastracode/@mastra/code-sdk from Resources/agent-runtime instead.
 */
async function runtimeImport<T>(spec: string): Promise<T> {
  if (!runtimeDir) return (await import(spec)) as T
  const m = /^((?:@[^/]+\/)?[^/]+)(\/.+)?$/.exec(spec)
  if (!m) throw new Error(`Invalid module specifier: ${spec}`)
  const pkgDir = path.join(runtimeDir, 'node_modules', m[1])
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
    main?: string
    exports?: Record<string, unknown>
  }
  const key = m[2] ? `.${m[2]}` : '.'
  let target = pkg.exports ? resolveExportTarget(pkg.exports[key]) : undefined
  if (!target && pkg.exports && m[2]) {
    // Literal "./*" substitution (e.g. @mastra/code-sdk maps ./* -> ./dist/*.js).
    const wildcard = resolveExportTarget(pkg.exports['./*'])
    if (wildcard) target = wildcard.replace('*', m[2].slice(1))
  }
  if (!target) target = m[2] ? `.${m[2]}` : (pkg.main ?? './index.js')
  return (await import(pathToFileURL(path.join(pkgDir, target)).href)) as T
}

interface ParentPort {
  on(event: 'message', listener: (ev: { data: HostCommand }) => void): void
  postMessage(data: unknown): void
  start?: () => void
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort

function post(msg: HostMessage): void {
  try {
    parentPort.postMessage(msg)
  } catch {
    // Payload not structured-cloneable — fall back to a JSON-safe projection.
    try {
      parentPort.postMessage(JSON.parse(JSON.stringify(msg)))
    } catch (err) {
      parentPort.postMessage({
        t: 'log',
        level: 'error',
        msg: `Failed to serialize message: ${String(err)}`
      } satisfies HostMessage)
    }
  }
}

/** Make an arbitrary SDK event JSON/structured-clone safe. */
function sanitizeEvent(ev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ev)) {
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, stack: v.stack }
    } else if (v instanceof Date) {
      out[k] = v.getTime()
    } else if (typeof v === 'function') {
      // drop
    } else if (v !== null && typeof v === 'object') {
      try {
        out[k] = JSON.parse(JSON.stringify(v))
      } catch {
        out[k] = String(v)
      }
    } else {
      out[k] = v
    }
  }
  return out
}

/** Project a GoalObjectiveRecord onto the wire-safe GoalInfo shape. */
function mapGoal(record: {
  objective: string
  status: 'active' | 'paused' | 'done'
  runsUsed: number
  maxRuns?: number
  judgeModelId?: string
  pausedReason?: string
  startedAt: number
  updatedAt: number
}): Record<string, unknown> {
  return {
    objective: record.objective,
    status: record.status,
    runsUsed: record.runsUsed,
    maxRuns: record.maxRuns,
    judgeModelId: record.judgeModelId,
    pausedReason: record.pausedReason,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt
  }
}

async function main(): Promise<void> {
  const bootRaw = process.env.YARDARM_BOOT
  if (!bootRaw) {
    post({ t: 'boot-error', error: 'YARDARM_BOOT env var missing' })
    process.exit(1)
  }
  const boot: HostBootConfig = JSON.parse(bootRaw)
  runtimeDir = boot.agentRuntimePath

  const nodeVersion = process.versions.node
  const [major, minor] = nodeVersion.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 19)) {
    post({ t: 'boot-error', error: `mastracode requires Node >= 22.19.0, got ${nodeVersion}` })
    process.exit(1)
  }

  process.chdir(boot.cwd)

  let sdk: typeof import('mastracode')
  try {
    sdk = await runtimeImport<typeof import('mastracode')>('mastracode')
  } catch (err) {
    post({ t: 'boot-error', error: `Failed to load mastracode: ${String(err)}` })
    process.exit(1)
    return
  }

  const initialState: Record<string, unknown> = {}
  if (boot.yolo !== undefined) initialState.yolo = boot.yolo
  if (boot.thinkingLevel) initialState.thinkingLevel = boot.thinkingLevel

  let mc: Awaited<ReturnType<typeof sdk.createMastraCode>>
  try {
    mc = await sdk.createMastraCode({
      cwd: boot.cwd,
      initialState: Object.keys(initialState).length ? (initialState as never) : undefined
    })
  } catch (err) {
    post({
      t: 'boot-error',
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    })
    process.exit(1)
    return
  }

  const { session, controller, authStorage } = mc

  /** Project session state onto the wire-safe SessionStateInfo shape. */
  const stateInfo = (): Record<string, unknown> => {
    const st = (session.state.get() ?? {}) as Record<string, unknown>
    return {
      notifications: st.notifications ?? 'off',
      smartEditing: st.smartEditing ?? false,
      sandboxAllowedPaths: st.sandboxAllowedPaths ?? []
    }
  }

  /** Project LoadedPlugins onto the wire-safe PluginInfo shape. */
  const mapPlugins = (list: typeof mc.loadedPlugins): Record<string, unknown>[] =>
    list.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      scope: p.scope,
      status: p.status,
      toolNames: p.toolNames,
      skillCount: p.skillPaths?.length ?? 0,
      commandCount: p.commandPaths?.length ?? 0,
      error: p.error
    }))

  session.subscribe((event) => {
    // The display_state_changed firehose is large and derivable; skip it.
    if ((event as { type: string }).type === 'display_state_changed') return
    post({ t: 'event', ev: sanitizeEvent(event as unknown as Record<string, unknown>) as never })
  })

  // Restore or select the thread before reporting ready.
  if (boot.threadId) {
    try {
      await session.thread.switch({ threadId: boot.threadId })
    } catch (err) {
      post({ t: 'log', level: 'error', msg: `thread.switch failed: ${String(err)}` })
    }
  }
  if (boot.mode) {
    try {
      await session.mode.switch({ modeId: boot.mode })
    } catch (err) {
      post({ t: 'log', level: 'error', msg: `mode.switch failed: ${String(err)}` })
    }
  }
  if (boot.modelId) {
    try {
      await session.model.switch({ modelId: boot.modelId })
    } catch (err) {
      post({ t: 'log', level: 'error', msg: `model.switch failed: ${String(err)}` })
    }
  }

  post({
    t: 'ready',
    threadId: session.thread.getId(),
    mode: session.mode.get(),
    modelId: session.model.get(),
    state: JSON.parse(JSON.stringify(session.state.get() ?? {}))
  })

  async function respond(reqId: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      const data = await fn()
      post({ t: 'response', reqId, ok: true, data })
    } catch (err) {
      post({ t: 'response', reqId, ok: false, error: String(err) })
    }
  }

  /** In-flight OAuth login flows, keyed by the login command's reqId. */
  const oauthFlows = new Map<
    string,
    { abort: AbortController; resolvePrompt: ((value: string) => void) | null }
  >()

  parentPort.on('message', (ev) => {
    const cmd = ev.data
    void (async () => {
      try {
        switch (cmd.t) {
          case 'send':
            session.sendMessage({ content: cmd.text, files: cmd.files }).catch((err: unknown) => {
              post({ t: 'log', level: 'error', msg: `sendMessage failed: ${String(err)}` })
              post({
                t: 'event',
                ev: { type: 'error', error: { message: String(err) } }
              })
            })
            break
          case 'followUp':
            // Queues behind the active run; sends immediately when idle.
            session.followUp({ content: cmd.text }).catch((err: unknown) => {
              post({ t: 'log', level: 'error', msg: `followUp failed: ${String(err)}` })
              post({
                t: 'event',
                ev: { type: 'error', error: { message: String(err) } }
              })
            })
            break
          case 'approve':
            session.respondToToolApproval({
              decision: cmd.decision,
              toolCallId: cmd.toolCallId,
              declineContext: cmd.feedback ? { message: cmd.feedback } : undefined
            })
            break
          case 'alwaysAllowTool':
            await session.permissions.setForTool({ toolName: cmd.toolName, policy: 'allow' })
            break
          case 'suspension':
            await session.respondToToolSuspension({
              resumeData: cmd.resumeData,
              toolCallId: cmd.toolCallId
            })
            break
          case 'abort':
            session.abort()
            break
          case 'setMode':
            await session.mode.switch({ modeId: cmd.mode })
            break
          case 'setModel':
            await session.model.switch({ modelId: cmd.modelId })
            break
          case 'setYolo':
            await session.state.set({ yolo: cmd.yolo } as never)
            break
          case 'setThinking':
            await session.state.set({ thinkingLevel: cmd.level } as never)
            break
          case 'newThread':
            await respond(cmd.reqId, async () => {
              const thread = await session.thread.create()
              return { threadId: thread.id }
            })
            break
          case 'threadList':
            await respond(cmd.reqId, async () => {
              const threads = await session.thread.list()
              const firsts = await session.thread.firstUserMessages({
                threadIds: threads.map((t) => t.id)
              })
              const activeId = session.thread.getId()
              return threads
                .map((t) => {
                  const first = firsts.get(t.id)
                  const textPart = first?.content.find((c) => c.type === 'text')
                  return {
                    id: t.id,
                    title: t.title,
                    createdAt: new Date(t.createdAt).getTime(),
                    updatedAt: new Date(t.updatedAt).getTime(),
                    totalTokens: t.tokenUsage?.totalTokens,
                    preview:
                      textPart && 'text' in textPart ? textPart.text.slice(0, 200) : undefined,
                    active: t.id === activeId
                  }
                })
                .sort((a, b) => b.updatedAt - a.updatedAt)
            })
            break
          case 'threadSwitch':
            await respond(cmd.reqId, async () => {
              await session.thread.switch({ threadId: cmd.threadId })
              return { threadId: session.thread.getId() }
            })
            break
          case 'threadRename':
            await respond(cmd.reqId, async () => {
              // SDK constraint: rename applies to the session's active thread.
              await session.thread.rename({ title: cmd.title })
              return null
            })
            break
          case 'threadClone':
            await respond(cmd.reqId, async () => {
              const thread = await session.thread.clone({
                sourceThreadId: cmd.sourceThreadId,
                title: cmd.title
              })
              return { threadId: thread.id }
            })
            break
          case 'threadDelete':
            await respond(cmd.reqId, async () => {
              // Deleting the active thread would leave the session unbound;
              // move to a fresh thread first so the agent stream stays usable.
              if (session.thread.getId() === cmd.threadId) {
                await session.thread.create()
              }
              await session.thread.delete({ threadId: cmd.threadId })
              return { threadId: session.thread.getId() }
            })
            break
          case 'getPermissions':
            await respond(cmd.reqId, async () => {
              const rules = session.permissions.getRules()
              const grants = session.getGrants()
              return {
                categories: rules.categories,
                tools: rules.tools,
                grantedCategories: grants.categories,
                grantedTools: grants.tools
              }
            })
            break
          case 'setPermission':
            await respond(cmd.reqId, async () => {
              if (cmd.scope === 'category') {
                await session.permissions.setForCategory({
                  category: cmd.name as never,
                  policy: cmd.policy
                })
              } else {
                await session.permissions.setForTool({ toolName: cmd.name, policy: cmd.policy })
              }
              const rules = session.permissions.getRules()
              const grants = session.getGrants()
              return {
                categories: rules.categories,
                tools: rules.tools,
                grantedCategories: grants.categories,
                grantedTools: grants.tools
              }
            })
            break
          case 'goalGet':
            await respond(cmd.reqId, async () => {
              const threadId = session.thread.getId()
              if (!threadId) return null
              // The mode agent owns the objective methods (durable threadState 'goal' slot).
              const agent = controller.getCurrentAgent(session as never)
              const record = await agent.getObjective({ threadId })
              return record ? mapGoal(record) : null
            })
            break
          case 'goalSet':
            await respond(cmd.reqId, async () => {
              const threadId = session.thread.getId()
              if (!threadId) throw new Error('No active thread to attach the goal to')
              const agent = controller.getCurrentAgent(session as never)
              const record = await agent.setObjective(cmd.objective, {
                threadId,
                judgeModelId: cmd.judgeModelId,
                maxRuns: cmd.maxRuns
              })
              return record ? mapGoal(record) : null
            })
            break
          case 'goalClear':
            await respond(cmd.reqId, async () => {
              const threadId = session.thread.getId()
              if (!threadId) return null
              const agent = controller.getCurrentAgent(session as never)
              await agent.clearObjective({ threadId })
              return null
            })
            break
          case 'omGet':
            await respond(cmd.reqId, async () => {
              const st = (session.state.get() ?? {}) as Record<string, unknown>
              return {
                observerModelId: st.observerModelId,
                reflectorModelId: st.reflectorModelId,
                observationThreshold: st.observationThreshold,
                reflectionThreshold: st.reflectionThreshold,
                cavemanObservations: st.cavemanObservations,
                omScope: st.omScope
              }
            })
            break
          case 'omSet':
            await respond(cmd.reqId, async () => {
              const patch: Record<string, unknown> = {}
              for (const [k, v] of Object.entries(cmd.patch)) {
                if (v !== undefined) patch[k] = v
              }
              await session.state.set(patch as never)
              const st = (session.state.get() ?? {}) as Record<string, unknown>
              return {
                observerModelId: st.observerModelId,
                reflectorModelId: st.reflectorModelId,
                observationThreshold: st.observationThreshold,
                reflectionThreshold: st.reflectionThreshold,
                cavemanObservations: st.cavemanObservations,
                omScope: st.omScope
              }
            })
            break
          case 'listCommands':
            await respond(cmd.reqId, async () => {
              const loader = await runtimeImport<
                typeof import('@mastra/code-sdk/utils/slash-command-loader')
              >('@mastra/code-sdk/utils/slash-command-loader')
              const commands = await loader.loadCustomCommands(boot.cwd)
              return commands.map((c) => ({
                name: c.name,
                description: c.description,
                namespace: c.namespace
              }))
            })
            break
          case 'expandCommand':
            await respond(cmd.reqId, async () => {
              const loader = await runtimeImport<
                typeof import('@mastra/code-sdk/utils/slash-command-loader')
              >('@mastra/code-sdk/utils/slash-command-loader')
              const processor = await runtimeImport<
                typeof import('@mastra/code-sdk/utils/slash-command-processor')
              >('@mastra/code-sdk/utils/slash-command-processor')
              const commands = await loader.loadCustomCommands(boot.cwd)
              const meta = commands.find((c) => c.name === cmd.name)
              if (!meta) throw new Error(`Unknown command: /${cmd.name}`)
              const args = cmd.args.trim() ? cmd.args.trim().split(/\s+/) : []
              const prompt = await processor.processSlashCommand(meta, args, boot.cwd)
              return { prompt }
            })
            break
          case 'reloadHooks':
            await respond(cmd.reqId, async () => {
              mc.hookManager?.reload()
              return null
            })
            break
          case 'resourceInfo':
            await respond(cmd.reqId, async () => ({
              resourceId: session.identity.getResourceId()
            }))
            break
          case 'listPlugins':
            await respond(cmd.reqId, async () => mapPlugins(mc.loadedPlugins))
            break
          case 'pluginInstall':
            await respond(cmd.reqId, async () => {
              const pm = mc.pluginManager
              if (!pm) throw new Error('Plugin manager unavailable')
              if (cmd.source === 'local') await pm.installLocal(cmd.pathOrUrl, cmd.scope)
              else await pm.installGithub(cmd.pathOrUrl, cmd.scope)
              return mapPlugins(await pm.reload())
            })
            break
          case 'pluginUninstall':
            await respond(cmd.reqId, async () => {
              const pm = mc.pluginManager
              if (!pm) throw new Error('Plugin manager unavailable')
              await pm.uninstall(cmd.pluginId, cmd.scope)
              return mapPlugins(await pm.reload())
            })
            break
          case 'pluginSetEnabled':
            await respond(cmd.reqId, async () => {
              const pm = mc.pluginManager
              if (!pm) throw new Error('Plugin manager unavailable')
              await pm.setEnabled(cmd.pluginId, cmd.scope, cmd.enabled)
              return mapPlugins(await pm.reload())
            })
            break
          case 'pluginSetConfig':
            await respond(cmd.reqId, async () => {
              const pm = mc.pluginManager
              if (!pm) throw new Error('Plugin manager unavailable')
              await pm.setConfigValue(cmd.pluginId, cmd.scope, cmd.key, cmd.value)
              return mapPlugins(await pm.reload())
            })
            break
          case 'stateGet':
            await respond(cmd.reqId, async () => stateInfo())
            break
          case 'stateSet':
            await respond(cmd.reqId, async () => {
              const patch: Record<string, unknown> = {}
              for (const [k, v] of Object.entries(cmd.patch)) {
                if (v !== undefined) patch[k] = v
              }
              await session.state.set(patch as never)
              return stateInfo()
            })
            break
          case 'listSkills':
            await respond(cmd.reqId, async () => {
              const workspace = await controller.resolveWorkspace({ session: session as never })
              if (!workspace?.skills) return []
              const skills = await workspace.skills.list()
              return skills
                .filter((s) => s['user-invocable'] !== false)
                .map((s) => ({ name: s.name, description: s.description }))
            })
            break
          case 'runSkill':
            await respond(cmd.reqId, async () => {
              const workspace = await controller.resolveWorkspace({ session: session as never })
              if (!workspace?.skills) throw new Error('No workspace skills available')
              const skill = await workspace.skills.get(cmd.name)
              if (!skill) throw new Error(`Unknown skill: ${cmd.name}`)
              if (skill['user-invocable'] === false) {
                throw new Error(`Skill is not user-invocable: ${cmd.name}`)
              }
              const ws = await runtimeImport<typeof import('@mastra/core/workspace')>(
                '@mastra/core/workspace'
              )
              let content = ws.formatSkillActivation(skill)
              const args = cmd.args.trim()
              if (args) content += `\n\nARGUMENTS: ${args}`
              // Match the CLI: escape closing tags so the wrapper stays intact.
              const escaped = content.replaceAll('</skill>', '&lt;/skill&gt;')
              return {
                display: `/skill ${cmd.name}${args ? ` ${args}` : ''}`,
                prompt: `<skill name="${skill.name}">\n${escaped}\n</skill>`
              }
            })
            break
          case 'listPacks':
            await respond(cmd.reqId, async () => {
              const onboarding = await runtimeImport<
                typeof import('@mastra/code-sdk/onboarding/index')
              >('@mastra/code-sdk/onboarding/index')
              authStorage.reload()
              const models = await controller.listAvailableModels()
              // Replicates the CLI's ProviderAccess derivation (no exported helper).
              const accessLevel = (id: string): 'oauth' | 'apikey' | false => {
                const cred = authStorage.get(id)
                if (cred?.type === 'oauth') return 'oauth'
                if (cred?.type === 'api_key' && cred.key.trim()) return 'apikey'
                return false
              }
              const hasEnv = (provider: string): 'apikey' | false =>
                models.some((m) => m.provider === provider && m.hasApiKey) ? 'apikey' : false
              const access: Record<string, 'oauth' | 'apikey' | false> = {
                anthropic: accessLevel('anthropic'),
                openai: accessLevel('openai-codex'),
                cerebras: hasEnv('cerebras'),
                google: hasEnv('google'),
                deepseek: hasEnv('deepseek'),
                'github-copilot': accessLevel('github-copilot')
              }
              for (const m of models) {
                if (m.hasApiKey && access[m.provider] === undefined) access[m.provider] = 'apikey'
              }
              const settings = await onboarding.loadSettings()
              const modePacks = onboarding
                .getAvailableModePacks(access as never, settings.customModelPacks)
                // 'custom' is the CLI's "New Custom Pack…" sentinel, not a real pack.
                .filter((p) => p.id !== 'custom')
                .map((p) => ({
                  id: p.id,
                  name: p.name,
                  description: p.description,
                  models: { ...p.models }
                }))
              const omPacks = onboarding.getAvailableOmPacks(access as never).map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                modelId: p.modelId
              }))
              return { modePacks, omPacks }
            })
            break
          case 'sttRegistry':
            await respond(cmd.reqId, async () => {
              const stt = await runtimeImport<
                typeof import('@mastra/code-sdk/voice/stt-registry')
              >('@mastra/code-sdk/voice/stt-registry')
              return stt.STT_MODELS.map((m) => ({
                provider: m.provider,
                model: m.model,
                label: m.label
              }))
            })
            break
          case 'listModels':
            await respond(cmd.reqId, async () => {
              const models = await controller.listAvailableModels()
              return models.map((m) => ({
                id: m.id,
                provider: m.provider,
                modelName: m.modelName,
                hasApiKey: m.hasApiKey,
                useCount: m.useCount
              }))
            })
            break
          case 'authList':
            await respond(cmd.reqId, async () => {
              // Pick up keys written by other hosts / the mastracode CLI.
              authStorage.reload()
              // list() returns raw auth.json keys; API keys are stored under
              // an `apikey:<provider>` prefix while OAuth logins use the bare
              // provider name. Normalize to plain provider names.
              const providers = new Set(
                authStorage
                  .list()
                  .map((entry: string) =>
                    entry.startsWith('apikey:') ? entry.slice('apikey:'.length) : entry
                  )
              )
              return [...providers].map((provider) => ({
                provider,
                hasKey: authStorage.hasStoredApiKey(provider) || authStorage.isLoggedIn(provider)
              }))
            })
            break
          case 'authSet':
            await respond(cmd.reqId, async () => {
              authStorage.reload()
              // Passing the provider's env var makes the key visible to model
              // resolution in this process immediately (not just on next boot).
              let envVar: string | undefined
              try {
                const models = await controller.listAvailableModels()
                envVar = models.find((m) => m.provider === cmd.provider)?.apiKeyEnvVar
              } catch {
                // Best effort — the key still lands in auth.json for next boot.
              }
              authStorage.setStoredApiKey(cmd.provider, cmd.key, envVar)
              return null
            })
            break
          case 'authRemove':
            await respond(cmd.reqId, async () => {
              authStorage.reload()
              // API keys live under the `apikey:` prefix in auth.json.
              authStorage.remove(`apikey:${cmd.provider}`)
              return null
            })
            break
          case 'oauthProviders':
            await respond(cmd.reqId, async () => {
              const auth = await runtimeImport<typeof import('@mastra/code-sdk/auth/index')>(
                '@mastra/code-sdk/auth/index'
              )
              authStorage.reload()
              return auth.getOAuthProviders().map((p) => ({
                id: p.id,
                name: p.name,
                usesCallbackServer: p.usesCallbackServer,
                authModes: p.authModes?.map((m) => ({
                  id: m.id,
                  name: m.name,
                  description: m.description
                })),
                loggedIn: authStorage.isLoggedIn(p.id)
              }))
            })
            break
          case 'oauthLogin': {
            const flowId = cmd.reqId
            const flow = {
              abort: new AbortController(),
              resolvePrompt: null as ((value: string) => void) | null
            }
            oauthFlows.set(flowId, flow)
            await respond(flowId, async () => {
              try {
                authStorage.reload()
                // login() persists the credential into auth.json on success.
                await authStorage.login(cmd.provider, {
                  authMode: cmd.authMode,
                  signal: flow.abort.signal,
                  onAuth: (info) =>
                    post({
                      t: 'oauth-status',
                      reqId: flowId,
                      kind: 'auth-url',
                      url: info.url,
                      instructions: info.instructions
                    }),
                  onProgress: (message) =>
                    post({ t: 'oauth-status', reqId: flowId, kind: 'progress', message }),
                  onPrompt: (prompt) =>
                    new Promise<string>((resolve) => {
                      flow.resolvePrompt = resolve
                      post({
                        t: 'oauth-status',
                        reqId: flowId,
                        kind: 'prompt',
                        message: prompt.message,
                        placeholder: prompt.placeholder
                      })
                    })
                })
                return { loggedIn: authStorage.isLoggedIn(cmd.provider) }
              } finally {
                oauthFlows.delete(flowId)
              }
            })
            break
          }
          case 'oauthPrompt': {
            const flow = oauthFlows.get(cmd.reqId)
            if (flow?.resolvePrompt) {
              const resolve = flow.resolvePrompt
              flow.resolvePrompt = null
              resolve(cmd.value)
            }
            break
          }
          case 'oauthCancel':
            oauthFlows.get(cmd.reqId)?.abort.abort()
            break
          case 'oauthLogout':
            await respond(cmd.reqId, async () => {
              authStorage.reload()
              // Bare provider name = the OAuth credential (API keys live
              // under the apikey: prefix and are left untouched).
              authStorage.logout(cmd.provider)
              return null
            })
            break
          case 'shutdown':
            process.exit(0)
        }
      } catch (err) {
        post({ t: 'log', level: 'error', msg: `command ${cmd.t} failed: ${String(err)}` })
      }
    })()
  })

  parentPort.start?.()
}

main().catch((err) => {
  post({ t: 'boot-error', error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) })
  process.exit(1)
})
