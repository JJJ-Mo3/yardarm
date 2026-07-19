/**
 * Typed view of mastracode's global settings.json (GlobalSettings in
 * @mastra/code-sdk). Every level carries an index signature so unknown keys
 * written by the CLI are preserved on read-modify-write.
 */

export interface CustomProviderSetting {
  name: string
  url: string
  apiKey?: string
  models: string[]
  [key: string]: unknown
}

/** Result of probing an OpenAI-compatible server's /models endpoint. */
export interface ProbeResult {
  ok: boolean
  /** Normalized URL that responded (or the input base on failure). */
  url: string
  models: string[]
  error?: string
}

/** Snapshot of an in-flight Ollama model download (POST /api/pull). */
export interface PullJob {
  jobId: string
  model: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  /** Ollama's status line, e.g. "pulling manifest", "downloading". */
  statusText: string
  /** Bytes downloaded so far. */
  completed: number
  /** Total bytes (0 until known). */
  total: number
  error?: string
}

/** Whether a local Ollama install exists / its server is reachable. */
export type OllamaInstallStatus = 'running' | 'installed' | 'not-installed'

export interface MastraModelsSettings {
  /** Active model pack id; cleared when a mode default is set manually. */
  activeModelPackId?: string | null
  /** Explicit per-mode model overrides, e.g. { build: 'anthropic/claude-...' } */
  modeDefaults?: Record<string, string>
  activeOmPackId?: string | null
  omModelOverride?: string | null
  observerModelOverride?: string | null
  reflectorModelOverride?: string | null
  omObservationThreshold?: number | null
  omReflectionThreshold?: number | null
  omCavemanObservations?: boolean | null
  omObserveAttachments?: 'auto' | boolean | null
  /** Per-agent-type subagent model overrides, e.g. { explore: '...' } */
  subagentModels?: Record<string, string>
  goalJudgeModel?: string | null
  goalMaxTurns?: number | null
  [key: string]: unknown
}

export interface MastraPreferencesSettings {
  yolo?: boolean | null
  theme?: 'auto' | 'dark' | 'light'
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh'
  quietMode?: boolean
  quietModeMaxToolPreviewLines?: number
  [key: string]: unknown
}

/** Hold-space dictation config (VoiceSettings in the SDK). */
export interface MastraVoiceSettings {
  enabled?: boolean
  engine?: 'macos-native' | 'cloud'
  provider?: string
  model?: string
  [key: string]: unknown
}

export interface MastraStagehandSettings {
  env?: 'LOCAL' | 'BROWSERBASE'
  apiKey?: string
  projectId?: string
  preserveUserDataDir?: boolean
  [key: string]: unknown
}

/** Browser automation config (BrowserSettings in the SDK). */
export interface MastraBrowserSettings {
  enabled?: boolean
  provider?: 'stagehand' | 'agent-browser'
  headless?: boolean
  cdpUrl?: string
  profile?: string
  executablePath?: string
  scope?: 'shared' | 'thread'
  stagehand?: MastraStagehandSettings
  agentBrowser?: { storageState?: string; [key: string]: unknown }
  [key: string]: unknown
}

/** A user-defined model pack saved in settings.json. */
export interface CustomPackSetting {
  name: string
  models: Record<string, string>
  createdAt?: string
  [key: string]: unknown
}

/**
 * First-run onboarding state written by both the mastracode CLI and
 * Yardarm's wizard — completing it in either tool satisfies both.
 */
export interface MastraOnboardingSettings {
  completedAt?: string | null
  skippedAt?: string | null
  version?: number
  modePackId?: string | null
  omPackId?: string | null
  [key: string]: unknown
}

export interface MastraSettings {
  models?: MastraModelsSettings
  preferences?: MastraPreferencesSettings
  customProviders?: CustomProviderSetting[]
  customModelPacks?: CustomPackSetting[]
  voice?: MastraVoiceSettings
  browser?: MastraBrowserSettings
  onboarding?: MastraOnboardingSettings
  [key: string]: unknown
}

/** Preference fields settable from the UI. */
export interface PreferencesPatch {
  yolo?: boolean | null
  theme?: 'auto' | 'dark' | 'light'
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh'
  quietMode?: boolean
  quietModeMaxToolPreviewLines?: number
}

export interface VoiceSettingsPatch {
  enabled?: boolean
  engine?: 'macos-native' | 'cloud'
  provider?: string
  model?: string | null
}

export interface BrowserSettingsPatch {
  enabled?: boolean
  provider?: 'stagehand' | 'agent-browser'
  headless?: boolean
  cdpUrl?: string | null
  profile?: string | null
  executablePath?: string | null
  scope?: 'shared' | 'thread' | null
  stagehand?: {
    env?: 'LOCAL' | 'BROWSERBASE'
    apiKey?: string | null
    projectId?: string | null
    preserveUserDataDir?: boolean
  }
  agentBrowser?: { storageState?: string | null }
}

/** OM fields settable from the UI (subset of MastraModelsSettings). */
export interface OmDefaultsPatch {
  observerModelOverride?: string | null
  reflectorModelOverride?: string | null
  omModelOverride?: string | null
  omObservationThreshold?: number | null
  omReflectionThreshold?: number | null
  omCavemanObservations?: boolean | null
}
