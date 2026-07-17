/**
 * Wire protocol between the main process and the agent-host utilityProcess.
 * This file plus agent-host.ts are the only places that need to change when
 * the mastracode SDK changes.
 */

/** main -> host */
export type HostCommand =
  | { t: 'send'; text: string }
  | {
      t: 'approve'
      toolCallId: string
      decision: 'approve' | 'decline' | 'always_allow_category'
      feedback?: string
    }
  | { t: 'alwaysAllowTool'; toolName: string }
  | { t: 'suspension'; toolCallId: string; resumeData: unknown }
  | { t: 'abort' }
  | { t: 'setMode'; mode: string }
  | { t: 'setModel'; modelId: string }
  | { t: 'setYolo'; yolo: boolean }
  | { t: 'setThinking'; level: string }
  | { t: 'newThread'; reqId: string }
  | { t: 'listModels'; reqId: string }
  | { t: 'authList'; reqId: string }
  | { t: 'authSet'; reqId: string; provider: string; key: string }
  | { t: 'authRemove'; reqId: string; provider: string }
  | { t: 'shutdown' }

/** host -> main */
export type HostMessage =
  | {
      t: 'ready'
      threadId: string | null
      mode: string
      modelId: string
      state: Record<string, unknown>
    }
  | { t: 'boot-error'; error: string }
  /** Raw mastracode AgentControllerEvent (JSON-safe projection) */
  | { t: 'event'; ev: AgentControllerEventLike }
  | { t: 'response'; reqId: string; ok: boolean; data?: unknown; error?: string }
  | { t: 'log'; level: 'info' | 'error'; msg: string }

/**
 * Loosely-typed view of mastracode's AgentControllerEvent union.
 * We match on the `type` discriminator and pass payloads through;
 * unknown event types are surfaced as raw events instead of crashing.
 */
export interface AgentControllerEventLike {
  type: string
  [key: string]: unknown
}

export interface ModelInfo {
  id: string
  provider: string
  modelName: string
  hasApiKey: boolean
  useCount?: number
}

export interface AuthEntry {
  provider: string
  hasKey: boolean
}

/** Passed to the host via the CODEZERO_BOOT env var (JSON). */
export interface HostBootConfig {
  cwd: string
  threadId?: string | null
  mode?: string
  modelId?: string
  yolo?: boolean
  thinkingLevel?: string
}
