/**
 * Parser for the projects.settings JSON blob. The column is free-form JSON so
 * future per-project settings can live there without migrations; unknown keys
 * must be preserved by writers (read-modify-write the parsed object).
 */
import { eq } from 'drizzle-orm'
import type { RepoHostSetting } from '../../../shared/ipc-types'
import { getDb, schema } from './index'

/** One per-project environment variable (Project Settings → Environment). */
export interface ProjectEnvVar {
  key: string
  value: string
  /** Display-only masking in the UI; the value is stored in plaintext. */
  secret?: boolean
}

export interface ProjectSettings {
  /** Repo-host override for PR/MR features; absent means auto-detect. */
  repoHost?: RepoHostSetting
  /** Env vars added to this project's agent hosts and terminals. */
  envVars?: ProjectEnvVar[]
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

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Vars the app controls itself — user values must never shadow them. */
const RESERVED_ENV_KEYS = new Set(['PATH', 'YARDARM_BOOT'])

/** Narrow a stored envVars entry (free-form JSON — validate defensively). */
function isEnvVar(v: unknown): v is ProjectEnvVar {
  const e = v as ProjectEnvVar
  return !!e && typeof e === 'object' && typeof e.key === 'string' && typeof e.value === 'string'
}

/** The validated envVars list stored for a project (empty when unset). */
export function projectEnvVars(projectId: string): ProjectEnvVar[] {
  const project = getDb()
    .select({ settings: schema.projects.settings })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get()
  const raw = parseProjectSettings(project?.settings ?? null).envVars
  if (!Array.isArray(raw)) return []
  return raw.filter(isEnvVar)
}

/**
 * The project's env vars as a spreadable record for spawned processes (agent
 * hosts and terminals). Invalid or reserved keys are dropped defensively —
 * the router validates on write, but the JSON blob is free-form.
 */
export function projectEnvRecord(projectId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of projectEnvVars(projectId)) {
    if (!ENV_KEY_RE.test(v.key) || RESERVED_ENV_KEYS.has(v.key)) continue
    out[v.key] = v.value
  }
  return out
}
