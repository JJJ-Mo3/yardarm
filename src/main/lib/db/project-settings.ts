/**
 * Parser for the projects.settings JSON blob. The column is free-form JSON so
 * future per-project settings can live there without migrations; unknown keys
 * must be preserved by writers (read-modify-write the parsed object).
 */
import { eq } from 'drizzle-orm'
import type { RepoHostSetting } from '../../../shared/ipc-types'
import { worktreeConfigHash } from '../git/setup-hash'
import { isWorktreeConfigEmpty, type WorktreeConfig } from '../git/worktree-config'
import { getDb, schema } from './index'

/** One per-project environment variable (Project Settings → Environment). */
export interface ProjectEnvVar {
  key: string
  value: string
  /** Display-only masking in the UI; the value is stored in plaintext. */
  secret?: boolean
}

/** A named reviewer profile steering /review prompts (Project Settings → General). */
export interface ReviewerPersona {
  id: string
  name: string
  instructions: string
}

export interface ProjectSettings {
  /** Repo-host override for PR/MR features; absent means auto-detect. */
  repoHost?: RepoHostSetting
  /** Env vars added to this project's agent hosts and terminals. */
  envVars?: ProjectEnvVar[]
  /** Reviewer personas selectable when starting a review. */
  reviewers?: ReviewerPersona[]
  /** Hash of the worktree setup/copy/teardown config the user approved (see setup-hash.ts). */
  trustedSetupHash?: string
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

/** Narrow a stored reviewers entry (free-form JSON — validate defensively). */
function isReviewerPersona(v: unknown): v is ReviewerPersona {
  const p = v as ReviewerPersona
  return (
    !!p &&
    typeof p === 'object' &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.instructions === 'string'
  )
}

/** The validated reviewer personas stored for a project (empty when unset). */
export function projectReviewers(projectId: string): ReviewerPersona[] {
  const project = getDb()
    .select({ settings: schema.projects.settings })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get()
  const raw = parseProjectSettings(project?.settings ?? null).reviewers
  if (!Array.isArray(raw)) return []
  return raw.filter(isReviewerPersona)
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

/** A bare command list is the setup-commands-only form of the worktree config. */
function asWorktreeConfig(config: WorktreeConfig | string[]): WorktreeConfig {
  return Array.isArray(config) ? { setup: config, copyFiles: [], teardown: [] } : config
}

/**
 * True when the user approved exactly this worktree config (setup commands,
 * copy-file patterns, teardown commands) for the project. It comes from a
 * repo file, so nothing in it runs or is copied unapproved.
 */
export function isSetupTrusted(projectId: string, config: WorktreeConfig | string[]): boolean {
  const project = getDb()
    .select({ settings: schema.projects.settings })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get()
  const trusted = parseProjectSettings(project?.settings ?? null).trustedSetupHash
  return typeof trusted === 'string' && trusted === worktreeConfigHash(asWorktreeConfig(config))
}

/** Record the user's approval of this worktree config (an empty one clears it). */
export function trustSetupCommands(projectId: string, config: WorktreeConfig | string[]): void {
  const db = getDb()
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()
  if (!project) throw new Error('Project not found')
  // Read-modify-write the JSON blob so unknown keys are preserved.
  const settings = parseProjectSettings(project.settings)
  const next = asWorktreeConfig(config)
  if (!isWorktreeConfigEmpty(next)) settings.trustedSetupHash = worktreeConfigHash(next)
  else delete settings.trustedSetupHash
  const serialized = Object.keys(settings).length > 0 ? JSON.stringify(settings) : null
  db.update(schema.projects)
    .set({ settings: serialized, updatedAt: Date.now() })
    .where(eq(schema.projects.id, projectId))
    .run()
}
