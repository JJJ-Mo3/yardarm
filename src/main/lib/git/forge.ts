/**
 * Repo-forge abstraction: detects whether a working tree talks to GitHub or
 * GitLab (from the origin remote, with a per-project override stored in
 * projects.settings) and dispatches PR/MR operations to the matching CLI
 * wrapper (gh.ts / glab.ts). MRs are mapped onto the PrSummary shape so the
 * renderer is provider-agnostic apart from copy.
 */
import { execFile } from 'node:child_process'
import { eq } from 'drizzle-orm'
import type { RepoHostSetting, RepoProvider } from '../../../shared/ipc-types'
import { getDb, schema } from '../db'
import { parseProjectSettings } from '../db/project-settings'
import { detectForgeFromRemoteUrl } from './forge-detect'
import { createPr, ghPath, listPrs, prForBranch, type PrSummary } from './gh'
import { createMr, glabPath, listMrs, mrForBranch } from './glab'

export { detectForgeFromRemoteUrl } from './forge-detect'

/** URL of the `origin` remote at cwd, or null if there is none. */
export function originRemoteUrl(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 10_000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null)
    })
  })
}

/**
 * Per-project repoHost setting for the working tree at cwd. cwd is either a
 * project root or a chat worktree; both resolve to the owning project row.
 */
export function resolveProjectRepoHost(cwd: string): RepoHostSetting {
  try {
    const db = getDb()
    let project = db.select().from(schema.projects).where(eq(schema.projects.path, cwd)).get()
    if (!project) {
      const chat = db.select().from(schema.chats).where(eq(schema.chats.worktreePath, cwd)).get()
      if (chat) {
        project = db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, chat.projectId))
          .get()
      }
    }
    const repoHost = project ? parseProjectSettings(project.settings).repoHost : undefined
    return repoHost === 'github' || repoHost === 'gitlab' ? repoHost : 'auto'
  } catch {
    return 'auto'
  }
}

export interface ForgeInfo {
  /** Effective provider (override, else origin-remote detection); null when unknown. */
  provider: RepoProvider | null
  /** Whether that provider's CLI is installed (always false when provider is null). */
  cliAvailable: boolean
  cliName: 'gh' | 'glab' | null
}

/** Effective provider + CLI availability for the working tree at cwd. */
export async function forgeInfo(cwd: string): Promise<ForgeInfo> {
  const override = resolveProjectRepoHost(cwd)
  let provider: RepoProvider | null
  if (override === 'auto') {
    const url = await originRemoteUrl(cwd)
    provider = url ? detectForgeFromRemoteUrl(url) : null
  } else {
    provider = override
  }
  if (provider === 'github') {
    return { provider, cliAvailable: (await ghPath()) !== null, cliName: 'gh' }
  }
  if (provider === 'gitlab') {
    return { provider, cliAvailable: (await glabPath()) !== null, cliName: 'glab' }
  }
  return { provider: null, cliAvailable: false, cliName: null }
}

async function requireProvider(cwd: string): Promise<RepoProvider> {
  const { provider } = await forgeInfo(cwd)
  if (!provider) {
    throw new Error(
      'No GitHub or GitLab origin remote detected — set the repository host in Project Settings'
    )
  }
  return provider
}

/** Open PRs/MRs for the repo at cwd via the provider's CLI. */
export async function forgeListPrs(cwd: string, limit = 20): Promise<PrSummary[]> {
  const provider = await requireProvider(cwd)
  return provider === 'gitlab' ? listMrs(cwd, limit) : listPrs(cwd, limit)
}

/** The open PR/MR for the branch checked out at cwd, or null if there is none. */
export async function forgePrForBranch(
  cwd: string
): Promise<{ number: number; title: string; url: string } | null> {
  const provider = await requireProvider(cwd)
  return provider === 'gitlab' ? mrForBranch(cwd) : prForBranch(cwd)
}

/** Create a PR/MR for the branch checked out at cwd via the provider's CLI. */
export async function forgeCreatePr(
  cwd: string,
  opts: { title: string; body: string; base?: string; draft?: boolean }
): Promise<{ url: string }> {
  const provider = await requireProvider(cwd)
  return provider === 'gitlab' ? createMr(cwd, opts) : createPr(cwd, opts)
}
