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
  [key: string]: unknown
}

export interface MastraSettings {
  models?: MastraModelsSettings
  preferences?: MastraPreferencesSettings
  customProviders?: CustomProviderSetting[]
  [key: string]: unknown
}

/** OM fields settable from the UI (subset of MastraModelsSettings). */
export interface OmDefaultsPatch {
  observerModelOverride?: string | null
  reflectorModelOverride?: string | null
  omObservationThreshold?: number | null
  omReflectionThreshold?: number | null
  omCavemanObservations?: boolean | null
}
