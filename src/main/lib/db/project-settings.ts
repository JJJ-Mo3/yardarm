/**
 * Parser for the projects.settings JSON blob. The column is free-form JSON so
 * future per-project settings can live there without migrations; unknown keys
 * must be preserved by writers (read-modify-write the parsed object).
 */
import type { RepoHostSetting } from '../../../shared/ipc-types'

export interface ProjectSettings {
  /** Repo-host override for PR/MR features; absent means auto-detect. */
  repoHost?: RepoHostSetting
  [key: string]: unknown
}

/** Parse a projects.settings value; null/invalid JSON yields an empty object. */
export function parseProjectSettings(raw: string | null): ProjectSettings {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProjectSettings
    }
  } catch {
    // Corrupt settings shouldn't break project features; treat as unset.
  }
  return {}
}
