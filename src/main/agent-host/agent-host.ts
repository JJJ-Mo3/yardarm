/**
 * Agent host — runs inside an Electron utilityProcess, one per active chat.
 *
 * Boots mastracode with cwd pointed at the chat's git worktree and bridges
 * the interactive Session API to the main process over parentPort messages.
 * This is the single integration point with the mastracode SDK.
 */
import type { HostBootConfig, HostCommand, HostMessage } from '../../shared/ipc-types'

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

async function main(): Promise<void> {
  const bootRaw = process.env.CODEZERO_BOOT
  if (!bootRaw) {
    post({ t: 'boot-error', error: 'CODEZERO_BOOT env var missing' })
    process.exit(1)
  }
  const boot: HostBootConfig = JSON.parse(bootRaw)

  const nodeVersion = process.versions.node
  const [major, minor] = nodeVersion.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 19)) {
    post({ t: 'boot-error', error: `mastracode requires Node >= 22.19.0, got ${nodeVersion}` })
    process.exit(1)
  }

  process.chdir(boot.cwd)

  let sdk: typeof import('mastracode')
  try {
    sdk = await import('mastracode')
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

  parentPort.on('message', (ev) => {
    const cmd = ev.data
    void (async () => {
      try {
        switch (cmd.t) {
          case 'send':
            session.sendMessage({ content: cmd.text }).catch((err: unknown) => {
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
