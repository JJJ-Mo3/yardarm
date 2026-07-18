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
  | { t: 'threadList'; reqId: string }
  | { t: 'threadSwitch'; reqId: string; threadId: string }
  | { t: 'threadRename'; reqId: string; title: string }
  | { t: 'threadClone'; reqId: string; sourceThreadId?: string; title?: string }
  | { t: 'threadDelete'; reqId: string; threadId: string }
  | { t: 'getPermissions'; reqId: string }
  | {
      t: 'setPermission'
      reqId: string
      scope: 'tool' | 'category'
      name: string
      policy: PermissionPolicy
    }
  | { t: 'goalGet'; reqId: string }
  | { t: 'goalSet'; reqId: string; objective: string; judgeModelId?: string; maxRuns?: number }
  | { t: 'goalClear'; reqId: string }
  | { t: 'omGet'; reqId: string }
  | { t: 'omSet'; reqId: string; patch: OmRuntimePatch }
  | { t: 'listModels'; reqId: string }
  | { t: 'listCommands'; reqId: string }
  | { t: 'expandCommand'; reqId: string; name: string; args: string }
  | { t: 'reloadHooks'; reqId: string }
  | { t: 'resourceInfo'; reqId: string }
  | { t: 'listPlugins'; reqId: string }
  | { t: 'authList'; reqId: string }
  | { t: 'authSet'; reqId: string; provider: string; key: string }
  | { t: 'authRemove'; reqId: string; provider: string }
  | { t: 'oauthProviders'; reqId: string }
  | { t: 'oauthLogin'; reqId: string; provider: string; authMode?: string }
  /** Answer a pending onPrompt of the login flow identified by reqId. */
  | { t: 'oauthPrompt'; reqId: string; value: string }
  /** Abort the login flow identified by reqId. */
  | { t: 'oauthCancel'; reqId: string }
  | { t: 'oauthLogout'; reqId: string; provider: string }
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
  /** Intermediate status of an OAuth login flow (reqId = the flow's id). */
  | {
      t: 'oauth-status'
      reqId: string
      kind: 'auth-url' | 'progress' | 'prompt'
      url?: string
      instructions?: string
      message?: string
      placeholder?: string
    }
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

/** An SDK OAuth provider (Anthropic, OpenAI Codex, GitHub Copilot). */
export interface OAuthProviderInfo {
  id: string
  name: string
  usesCallbackServer?: boolean
  authModes?: Array<{ id: string; name: string; description?: string }>
  loggedIn: boolean
}

/**
 * OAuth flow status relayed to the renderer. The host emits auth-url,
 * progress and prompt; done/error are synthesized in the main process when
 * the login request settles.
 */
export interface OAuthStatusEvent {
  flowId: string
  kind: 'auth-url' | 'progress' | 'prompt' | 'done' | 'error'
  url?: string
  instructions?: string
  message?: string
  placeholder?: string
}

/** Custom .md slash command discovered by the SDK loader. */
export interface SlashCommandInfo {
  name: string
  description: string
  namespace?: string
}

/** A mastracode thread as listed for the Threads UI. */
export interface ThreadInfo {
  id: string
  title?: string
  createdAt: number
  updatedAt: number
  totalTokens?: number
  /** First user message, truncated — fallback display title. */
  preview?: string
  /** Whether this is the session's currently bound thread. */
  active: boolean
}

/** The durable goal objective for the session's active thread. */
export interface GoalInfo {
  objective: string
  status: 'active' | 'paused' | 'done'
  runsUsed: number
  maxRuns?: number
  judgeModelId?: string
  pausedReason?: string
  startedAt: number
  updatedAt: number
}

/** Observational Memory runtime config, read from live session state. */
export interface OmRuntimeInfo {
  observerModelId?: string
  reflectorModelId?: string
  observationThreshold?: number
  reflectionThreshold?: number
  cavemanObservations?: boolean
  omScope?: string
}

export type OmRuntimePatch = Partial<
  Pick<
    OmRuntimeInfo,
    | 'observerModelId'
    | 'reflectorModelId'
    | 'observationThreshold'
    | 'reflectionThreshold'
    | 'cavemanObservations'
  >
>

/** The session's live memory resource id. */
export interface ResourceInfo {
  resourceId: string
}

/** A loaded mastracode plugin/skill pack (display-only). */
export interface PluginInfo {
  id: string
  name?: string
  description?: string
  scope: string
  status: string
  toolNames: string[]
  skillCount: number
  commandCount: number
  error?: string
}

export type PermissionPolicy = 'allow' | 'ask' | 'deny'

/** Tool categories mastracode groups permissions by. */
export const TOOL_CATEGORIES = ['read', 'edit', 'execute', 'mcp', 'other'] as const
export type ToolCategoryName = (typeof TOOL_CATEGORIES)[number]

/**
 * Snapshot of the session's tool-permission state: persisted rules (session
 * state, survive restarts with the thread) plus in-memory "always allow"
 * grants (reset when the agent process restarts).
 */
export interface PermissionsSnapshot {
  categories: Partial<Record<string, PermissionPolicy>>
  tools: Partial<Record<string, PermissionPolicy>>
  grantedCategories: string[]
  grantedTools: string[]
}

/** Passed to the host via the YARDARM_BOOT env var (JSON). */
export interface HostBootConfig {
  cwd: string
  threadId?: string | null
  mode?: string
  modelId?: string
  yolo?: boolean
  thinkingLevel?: string
}
