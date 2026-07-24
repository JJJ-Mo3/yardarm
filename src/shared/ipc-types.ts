/**
 * Wire protocol between the main process and the agent-host utilityProcess.
 * This file plus agent-host.ts are the only places that need to change when
 * the mastracode SDK changes.
 */

/** main -> host */
export type HostCommand =
  | { t: 'send'; text: string; files?: FileAttachment[] }
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
  /**
   * Rollback support: delete the agent's memory of every thread message after
   * the anchor (last surviving assistant message). The revert note itself is
   * delivered by the main process with the next message send.
   */
  | { t: 'rewindThread'; reqId: string; anchorMessageId: string }
  /**
   * Deliver an IDE-edit note to the agent: mid-run as a system-reminder
   * signal, or — when the session is idle with a bound thread — persisted
   * straight into the thread's memory for the next run. Never starts a run.
   * Responds with an IdeNoteResult; delivered: false when a tool
   * approval/suspension/abort is parked or no thread exists yet.
   */
  | { t: 'ideNote'; reqId: string; text: string }
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
  /** Adjust judge/max-runs or pause/resume the existing goal (status 'done' is judge-only). */
  | {
      t: 'goalUpdate'
      reqId: string
      judgeModelId?: string
      maxRuns?: number
      status?: 'active' | 'paused'
    }
  | { t: 'omGet'; reqId: string }
  | { t: 'omSet'; reqId: string; patch: OmRuntimePatch }
  | { t: 'listModels'; reqId: string }
  | { t: 'listCommands'; reqId: string }
  | { t: 'expandCommand'; reqId: string; name: string; args: string }
  | { t: 'reloadHooks'; reqId: string }
  | { t: 'resourceInfo'; reqId: string }
  | { t: 'listPlugins'; reqId: string }
  | {
      t: 'pluginInstall'
      reqId: string
      source: 'local' | 'github'
      pathOrUrl: string
      scope: PluginScope
    }
  | { t: 'pluginUninstall'; reqId: string; pluginId: string; scope: PluginScope }
  | { t: 'pluginSetEnabled'; reqId: string; pluginId: string; scope: PluginScope; enabled: boolean }
  | {
      t: 'pluginSetConfig'
      reqId: string
      pluginId: string
      scope: PluginScope
      key: string
      value: string | boolean
    }
  /** Read session-state keys (notifications, smartEditing, sandboxAllowedPaths). */
  | { t: 'stateGet'; reqId: string }
  | { t: 'stateSet'; reqId: string; patch: SessionStatePatch }
  | { t: 'listSkills'; reqId: string }
  /** Activate a workspace skill: returns the display text + expanded content. */
  | { t: 'runSkill'; reqId: string; name: string; args: string }
  | { t: 'listPacks'; reqId: string }
  | { t: 'sttRegistry'; reqId: string }
  /**
   * Cloud STT: transcribe a recorded audio clip. provider/model are the
   * current voice settings, read by main at call time (hosts read
   * settings.json only at boot, but dictation must honor live edits).
   */
  | {
      t: 'transcribe'
      reqId: string
      /** Base64 audio (no data: prefix). */
      audioBase64: string
      /** e.g. 'audio/webm;codecs=opus' */
      mimeType: string
      provider?: string
      model?: string
    }
  | { t: 'authList'; reqId: string }
  | { t: 'authSet'; reqId: string; provider: string; key: string }
  | { t: 'authRemove'; reqId: string; provider: string }
  /** Credentials changed elsewhere — re-read auth.json and drop model caches. */
  | { t: 'authReload'; reqId: string }
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

/** Result of an ideNote command; reason explains a held (undelivered) note. */
export interface IdeNoteResult {
  delivered: boolean
  /** 'mid-run' = signalled onto the live run; 'persisted' = written into thread memory. */
  mode?: 'mid-run' | 'persisted'
  reason?: 'idle' | 'approval' | 'suspension' | 'aborting'
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

/** A loaded mastracode plugin/skill pack. */
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

/** Where a plugin is installed: global (~/.mastracode) or project-local. */
export type PluginScope = 'global' | 'project'

/** Base64 file attachment for Session.sendMessage. */
export interface FileAttachment {
  data: string
  mediaType: string
  filename?: string
}

/** Session-state keys exposed to the UI (subset of MastraCodeState). */
export interface SessionStateInfo {
  notifications: 'bell' | 'system' | 'both' | 'off'
  smartEditing: boolean
  sandboxAllowedPaths: string[]
}

export type SessionStatePatch = Partial<SessionStateInfo>

/** A user-invocable workspace skill (SKILL.md). */
export interface SkillInfo {
  name: string
  description?: string
}

/** A built-in or custom model pack (per-mode model selections). */
export interface ModePackInfo {
  id: string
  name: string
  description?: string
  models: Record<string, string>
}

/** An Observational Memory model pack. */
export interface OmPackInfo {
  id: string
  name: string
  description?: string
  modelId: string
}

export interface PacksInfo {
  modePacks: ModePackInfo[]
  omPacks: OmPackInfo[]
}

/** An STT registry entry for the voice settings picker. */
export interface SttModelInfo {
  provider: string
  model: string
  label: string
  /** A usable API key exists (env var or stored apikey:<provider> — never OAuth). */
  hasKey: boolean
  /** Env var the host/CLI reads for this provider (e.g. GROQ_API_KEY). */
  envVar: string
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
  /**
   * Packaged builds only: absolute path to the vendored mastracode runtime
   * (Resources/agent-runtime). The host imports mastracode/@mastra/code-sdk
   * from its node_modules instead of the app's bundled tree.
   */
  agentRuntimePath?: string
}
