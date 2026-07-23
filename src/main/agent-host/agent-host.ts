/**
 * Agent host — runs inside an Electron utilityProcess, one per active chat.
 *
 * Boots mastracode with cwd pointed at the chat's git worktree and bridges
 * the interactive Session API to the main process over parentPort messages.
 * This is the single integration point with the mastracode SDK.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HostBootConfig, HostCommand, HostMessage, SttModelInfo } from '../../shared/ipc-types'
import { patchApprovalRunBudget } from './approval-run-budget'
import { installNoTimeoutFetch } from './no-timeout-fetch'
import {
  buildSttRequest,
  envVarFor,
  httpErrorMessage,
  missingKeyMessage,
  parseDeepgramTranscription,
  parseOpenAiTranscription,
  resolveSttApiKey
} from './stt-transcribe'
import { shouldAutoApprove } from './task-auto-approve'

// The SDK drives model requests through globalThis.fetch; disable undici's
// ~300s idle timeouts so slow local models can't die with "terminated".
installNoTimeoutFetch()

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

/**
 * submit_plan suspends with only `{path}` — the plan markdown is not in the
 * payload (the TUI reads it from disk too). Merge `{title, plan}` into the
 * suspendPayload so the UI can show the plan without a second round-trip.
 * Mirrors code-sdk's resolvePlanPath/readPlanFile.
 */
function enrichPlanSuspension(ev: Record<string, unknown>): void {
  try {
    const payload = ev.suspendPayload as Record<string, unknown> | undefined
    const planPath = typeof payload?.path === 'string' ? payload.path : undefined
    if (!payload || !planPath) return
    const abs = path.isAbsolute(planPath) ? planPath : path.resolve(process.cwd(), planPath)
    const raw = readFileSync(abs, 'utf-8')
    const lines = raw.split(/\r?\n/)
    const headingIndex = lines.findIndex((line) => line.trim().length > 0)
    const heading = headingIndex >= 0 ? lines[headingIndex] : undefined
    if (heading?.startsWith('# ')) {
      payload.title = heading.slice(2).trim()
      payload.plan = lines
        .slice(headingIndex + 1)
        .join('\n')
        .replace(/^\n+/, '')
        .trimEnd()
    } else {
      payload.title = ''
      payload.plan = raw.trimEnd()
    }
  } catch {
    // Plan file unreadable — leave the payload untouched; the UI falls back.
  }
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

/**
 * Yardarm-specific system-prompt guidance, injected via the SDK's
 * pluginInstructions state (rendered under "# Plugin Instructions" by
 * getDynamicInstructions on every request). The UI turns the marked option
 * into a "Recommended" badge.
 */
const ASK_USER_GUIDANCE =
  'When you call the ask_user tool with options and one option is clearly the best choice, ' +
  'append " (Recommended)" to that option\'s label and list it first. ' +
  'Mark at most one option per question.'

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

  if (!existsSync(boot.cwd)) {
    post({
      t: 'boot-error',
      error: `Working directory no longer exists: ${boot.cwd}. Re-add the project or delete this chat.`
    })
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

  // SDK quirk: the tool-approval resume path omits the shared run budget
  // (maxSteps), capping the resumed run at the loop default of 5 steps — the
  // agent silently stops mid-task after an approval. Re-supply it at runtime.
  // Best-effort: if SDK internals change, degrade to the old behavior.
  try {
    patchApprovalRunBudget(session as unknown as Parameters<typeof patchApprovalRunBudget>[0])
  } catch (err) {
    post({ t: 'log', level: 'error', msg: `approval run-budget patch failed: ${String(err)}` })
  }

  /**
   * Drop the controller's ~10s model-catalog cache so the next listModels
   * recomputes hasApiKey after credentials change. availableModelsCache is a
   * plain property on the SDK's AgentController.
   */
  const bustModelCache = (): void => {
    ;(controller as unknown as { availableModelsCache?: unknown }).availableModelsCache = null
  }

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
    const ev = sanitizeEvent(event as unknown as Record<string, unknown>)
    if (ev.type === 'tool_suspended' && ev.toolName === 'submit_plan') enrichPlanSuspension(ev)
    // The SDK's always-allow tools (task list + interactive/planning tools)
    // shouldn't need user approval (see task-auto-approve.ts). Approve
    // in-process and skip the event so no approval card flashes; on any
    // failure fall through so the run can't hang invisibly.
    if (
      ev.type === 'tool_approval_required' &&
      typeof ev.toolName === 'string' &&
      typeof ev.toolCallId === 'string'
    ) {
      try {
        const rules = session.permissions.getRules()
        if (shouldAutoApprove(ev.toolName, rules.tools[ev.toolName])) {
          session.respondToToolApproval({ decision: 'approve', toolCallId: ev.toolCallId })
          return
        }
      } catch (err) {
        post({ t: 'log', level: 'error', msg: `task auto-approve failed: ${String(err)}` })
      }
    }
    post({ t: 'event', ev: ev as never })
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

  // Append Yardarm's ask_user guidance to the plugin-instructions state so it
  // reaches the system prompt. state.set merges partial updates; the includes
  // guard keeps this idempotent whether or not state persists across boots.
  try {
    const st = (session.state.get() ?? {}) as { pluginInstructions?: string[] }
    const existing = st.pluginInstructions ?? []
    if (!existing.includes(ASK_USER_GUIDANCE)) {
      await session.state.set({ pluginInstructions: [...existing, ASK_USER_GUIDANCE] } as never)
    }
  } catch (err) {
    // Guidance is best-effort; never block boot on it.
    post({ t: 'log', level: 'error', msg: `guidance state.set failed: ${String(err)}` })
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
          case 'suspension': {
            // SDK quirk: resumeToolCall re-enters the tool-approval gate with
            // requireToolApproval on, and only exempts ask_user/request_access.
            // submit_plan resumes ({action: 'approved'|'rejected', ...}) carry no
            // `approved` key, so the gate auto-denies them ("Tool call was not
            // approved by the user") and the plan decision/feedback never reaches
            // the tool. Spread in `approved: true` (approve the tool-call
            // execution — the plan verdict itself is carried by `action`); the
            // tool's zod resume schema strips the extra key.
            let resumeData = cmd.resumeData
            const pending = session.displayState.get().pendingSuspensions.get(cmd.toolCallId)
            if (
              pending?.toolName === 'submit_plan' &&
              resumeData !== null &&
              typeof resumeData === 'object' &&
              !Array.isArray(resumeData) &&
              !('approved' in resumeData)
            ) {
              resumeData = { ...(resumeData as Record<string, unknown>), approved: true }
            }
            await session.respondToToolSuspension({
              resumeData,
              toolCallId: cmd.toolCallId
            })
            break
          }
          case 'abort':
            session.abort()
            break
          case 'ideNote':
            await respond(cmd.reqId, async () => {
              // Replicate Session.sendSignal's own active-branch condition and
              // call sendSignal in the same synchronous tick: if any of these
              // are false the SDK falls to its idle path and *starts a new
              // run* ('wake'), which an IDE note must never do.
              const ds = session.displayState.get()
              const running =
                session.run.getRunId() !== null &&
                session.stream.activeRunId() !== null &&
                session.run.isRunning()
              // The active path declines a parked tool approval ("interrupted
              // by user message"), and a signal queued onto a suspended run
              // can drain into a paid follow-up run — hold the note back in
              // both cases (it rides the next prompt's suffix instead).
              if (!running || ds.pendingApproval !== null || ds.pendingSuspensions.size > 0) {
                return { delivered: false }
              }
              // Bare contents: the SDK wraps signals in its own
              // <system-reminder> markup and escapes nested tags.
              const result = session.sendSignal({ type: 'system-reminder', contents: cmd.text })
              await result.accepted
              return { delivered: true }
            })
            break
          case 'setMode':
            try {
              await session.mode.switch({ modeId: cmd.mode })
            } catch (err) {
              post({ t: 'log', level: 'error', msg: `mode.switch failed: ${String(err)}` })
              post({
                t: 'event',
                ev: { type: 'error', error: { message: `Mode switch failed: ${String(err)}` } }
              })
              // The manager persisted the requested mode optimistically; emit
              // the session's true mode so DB and UI revert to reality.
              post({
                t: 'event',
                ev: { type: 'mode_changed', modeId: session.mode.get() }
              })
            }
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
          case 'rewindThread':
            await respond(cmd.reqId, async () => {
              // Yardarm already truncated its own chat DB and restored the
              // files; here we bring the agent's memory in line. Assistant
              // message ids in Yardarm's DB are SDK message ids, so the last
              // surviving assistant message anchors the cut.
              const msgs = await session.thread.listActiveMessages()
              const idx = msgs.findIndex((m) => m.id === cmd.anchorMessageId)
              let deleted = 0
              if (idx >= 0) {
                const ids = msgs.slice(idx + 1).map((m) => m.id)
                if (ids.length > 0) {
                  // mc.memory is usually a dynamic factory ({requestContext})
                  // => Memory; it tolerates an empty context (all state reads
                  // are optional) and returns the storage-backed instance.
                  type MemoryLike = { deleteMessages(ids: string[]): Promise<void> }
                  const memRaw = mc.memory as unknown
                  const mem =
                    typeof memRaw === 'function'
                      ? (
                          memRaw as (args: {
                            requestContext: { get(k: string): unknown }
                          }) => MemoryLike
                        )({ requestContext: { get: () => undefined } })
                      : (memRaw as MemoryLike | undefined)
                  if (!mem) throw new Error('memory instance unavailable')
                  await mem.deleteMessages(ids)
                  deleted = ids.length
                }
              }
              return { deleted }
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
          case 'goalUpdate':
            await respond(cmd.reqId, async () => {
              const threadId = session.thread.getId()
              if (!threadId) return null
              const agent = controller.getCurrentAgent(session as never)
              // No-ops (returns undefined) when the thread has no objective.
              const record = await agent.updateObjectiveOptions({
                threadId,
                judgeModelId: cmd.judgeModelId,
                maxRuns: cmd.maxRuns,
                status: cmd.status
              })
              return record ? mapGoal(record) : null
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
              const ws =
                await runtimeImport<typeof import('@mastra/core/workspace')>(
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
              const stt = await runtimeImport<typeof import('@mastra/code-sdk/voice/stt-registry')>(
                '@mastra/code-sdk/voice/stt-registry'
              )
              // Pick up keys saved in other hosts / the CLI since boot.
              authStorage.reload()
              const keyByProvider = new Map<string, boolean>()
              for (const m of stt.STT_MODELS) {
                if (!keyByProvider.has(m.provider)) {
                  keyByProvider.set(
                    m.provider,
                    !!resolveSttApiKey(m.provider, process.env, (p) =>
                      authStorage.getStoredApiKey(p)
                    )
                  )
                }
              }
              const entries: SttModelInfo[] = stt.STT_MODELS.map((m) => ({
                provider: m.provider,
                model: m.model,
                label: m.label,
                hasKey: keyByProvider.get(m.provider) ?? false,
                envVar: envVarFor(m.provider)
              }))
              return entries
            })
            break
          case 'transcribe':
            await respond(cmd.reqId, async () => {
              const stt = await runtimeImport<typeof import('@mastra/code-sdk/voice/stt-registry')>(
                '@mastra/code-sdk/voice/stt-registry'
              )
              const entry = stt.resolveSTTModel(cmd.provider, cmd.model)
              // Pick up keys saved in other hosts / the CLI since boot.
              authStorage.reload()
              const apiKey = resolveSttApiKey(entry.provider, process.env, (p) =>
                authStorage.getStoredApiKey(p)
              )
              if (!apiKey) throw new Error(missingKeyMessage(entry.provider))
              const audio = Buffer.from(cmd.audioBase64, 'base64')
              const spec = buildSttRequest(entry, cmd.mimeType, apiKey)
              let body: FormData | Uint8Array
              if (spec.bodyKind === 'multipart') {
                const form = new FormData()
                form.append('file', new Blob([audio], { type: cmd.mimeType }), 'audio.webm')
                form.append('model', entry.model)
                body = form
              } else {
                body = audio
              }
              const res = await fetch(spec.url, { method: 'POST', headers: spec.headers, body })
              if (!res.ok) {
                throw new Error(httpErrorMessage(entry.provider, res.status, await res.text()))
              }
              const json = (await res.json()) as unknown
              const text =
                entry.resolver === 'deepgram'
                  ? parseDeepgramTranscription(json)
                  : parseOpenAiTranscription(json)
              return { text }
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
              bustModelCache()
              return null
            })
            break
          case 'authRemove':
            await respond(cmd.reqId, async () => {
              authStorage.reload()
              // API keys live under the `apikey:` prefix in auth.json.
              authStorage.remove(`apikey:${cmd.provider}`)
              bustModelCache()
              return null
            })
            break
          case 'authReload':
            await respond(cmd.reqId, async () => {
              // Credentials changed in another host — pick them up here.
              authStorage.reload()
              bustModelCache()
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
                bustModelCache()
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
              bustModelCache()
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
  post({
    t: 'boot-error',
    error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  })
  process.exit(1)
})
