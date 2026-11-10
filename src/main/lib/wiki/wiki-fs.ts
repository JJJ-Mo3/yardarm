/**
 * Repo-wiki storage: agent-generated markdown pages live per project under
 * <userData>/wiki/<projectId>/ — never inside the repo. Generation runs
 * write into a .yardarm-wiki/ staging folder in the chat worktree (kept out
 * of git via .git/info/exclude, which `git add -A` and checkpoint capture
 * both respect); collectStaging moves finished pages into the per-project
 * store and finalizes meta.json ({ sha, generatedAt }) for staleness checks.
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import path from 'path'

/** Staging folder the agent writes into, at the worktree root. */
export const WIKI_STAGING_DIR = '.yardarm-wiki'

export interface WikiMeta {
  /** Repo HEAD the wiki was generated from (null for commit-less repos). */
  sha: string | null
  generatedAt: number
}

export interface WikiPageInfo {
  name: string
  /** First `# ` heading, else the file name without extension. */
  title: string
}

/** Per-project wiki store directory (beside worktrees/ in userData). */
export function wikiDir(userDataDir: string, projectId: string): string {
  return path.join(userDataDir, 'wiki', projectId)
}

/** Flat wiki page names only — no separators, so no path traversal. */
const PAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/

function pageTitle(name: string, content: string): string {
  for (const line of content.split('\n')) {
    const m = /^#\s+(.+)$/.exec(line.trim())
    if (m) return m[1].trim()
  }
  return name.replace(/\.md$/, '')
}

/** Pages in a wiki store (index.md first, rest alphabetical). */
export async function listPages(dir: string): Promise<WikiPageInfo[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const names = entries
    .filter((e) => PAGE_NAME.test(e))
    .sort((a, b) => {
      if (a === 'index.md') return -1
      if (b === 'index.md') return 1
      return a.localeCompare(b)
    })
  const pages: WikiPageInfo[] = []
  for (const name of names) {
    try {
      const content = await readFile(path.join(dir, name), 'utf8')
      pages.push({ name, title: pageTitle(name, content) })
    } catch {
      // unreadable page — skip
    }
  }
  return pages
}

/** Page content; null for unknown or invalid names (traversal-safe). */
export async function readPage(dir: string, name: string): Promise<string | null> {
  if (!PAGE_NAME.test(name)) return null
  const full = path.resolve(dir, name)
  if (!full.startsWith(path.resolve(dir) + path.sep)) return null
  try {
    return await readFile(full, 'utf8')
  } catch {
    return null
  }
}

export async function readMeta(dir: string): Promise<WikiMeta | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as {
      sha?: unknown
      generatedAt?: unknown
    }
    return {
      sha: typeof raw.sha === 'string' ? raw.sha : null,
      generatedAt: typeof raw.generatedAt === 'number' ? raw.generatedAt : 0
    }
  } catch {
    return null
  }
}

/** Pre-run: create the staging folder with its meta (HEAD sha at send time). */
export async function writeStagingMeta(
  cwd: string,
  meta: { projectId: string; sha: string | null }
): Promise<void> {
  const dir = path.join(cwd, WIKI_STAGING_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({ ...meta, startedAt: Date.now() }, null, 2)
  )
}

/** True when the staging folder holds at least one finished page. */
export async function hasStagedPages(cwd: string): Promise<boolean> {
  try {
    const entries = await readdir(path.join(cwd, WIKI_STAGING_DIR))
    return entries.some((e) => PAGE_NAME.test(e))
  } catch {
    return false
  }
}

/**
 * Move finished staging pages into the per-project store, replacing any
 * previous wiki, and finalize meta.json. Retry-safe: without staged pages
 * (already collected, or the run never wrote any) this is a no-op.
 */
export async function collectStaging(cwd: string, destDir: string): Promise<boolean> {
  const staging = path.join(cwd, WIKI_STAGING_DIR)
  if (!(await hasStagedPages(cwd))) return false
  let sha: string | null = null
  try {
    const raw = JSON.parse(await readFile(path.join(staging, 'meta.json'), 'utf8')) as {
      sha?: unknown
    }
    if (typeof raw.sha === 'string') sha = raw.sha
  } catch {
    // staging meta lost — wiki still collectable, staleness just unknown
  }
  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })
  for (const entry of await readdir(staging)) {
    if (!PAGE_NAME.test(entry)) continue
    await copyFile(path.join(staging, entry), path.join(destDir, entry))
  }
  const meta: WikiMeta = { sha, generatedAt: Date.now() }
  await writeFile(path.join(destDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await rm(staging, { recursive: true, force: true })
  return true
}

/** Append a line to a git exclude file unless already present. */
export async function ensureExcludeLine(excludeFile: string, line: string): Promise<void> {
  let existing = ''
  try {
    existing = await readFile(excludeFile, 'utf8')
  } catch {
    // no exclude file yet
  }
  if (existing.split('\n').some((l) => l.trim() === line)) return
  await mkdir(path.dirname(excludeFile), { recursive: true })
  const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  await writeFile(excludeFile, `${existing}${sep}${line}\n`)
}

export async function deleteWiki(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
