/**
 * Pure glob expansion + selection for the "copy-files" list in
 * .yardarm/worktree.json: which files of the project folder a pattern names,
 * and which of them fit under the count/size caps. The directory listing is
 * injected so this stays testable without a filesystem; the fs/git side
 * (untracked filter, the actual copy) lives in copy-untracked.ts.
 *
 * Supported syntax, relative to the project root with `/` separators:
 * `*` (any run of characters within one path segment, dotfiles included),
 * `?` (one character), and a whole-segment `**` (zero or more directories).
 * A pattern that names a directory copies the files beneath it. Everything
 * else is literal. Patterns can never leave the root: absolute paths, `..`
 * segments and backslashes are rejected, and symlinks are never followed.
 */

/** Directories never descended into, even when a pattern names them. */
export const COPY_SKIP_DIRS = new Set(['.git', 'node_modules'])

export interface CopyLimits {
  /** Most files copied into one worktree. */
  maxFiles: number
  /** Most bytes copied into one worktree, summed over all files. */
  maxTotalBytes: number
  /** Most directory entries examined while expanding patterns. */
  maxEntries: number
}

export const DEFAULT_COPY_LIMITS: CopyLimits = {
  maxFiles: 200,
  maxTotalBytes: 25 * 1024 * 1024,
  maxEntries: 20_000
}

export interface DirEntry {
  name: string
  /** 'other' covers symlinks, sockets, devices — never copied or descended. */
  kind: 'file' | 'dir' | 'other'
}

/** Lists a directory given its `/`-separated path relative to the root ('' = root). */
export type ListDir = (relDir: string) => Promise<DirEntry[]>

/**
 * Normalize one pattern to its path segments, or null when it is unusable
 * (empty, absolute, escapes the root, or uses a backslash/NUL).
 */
export function parseCopyPattern(pattern: string): string[] | null {
  let p = pattern.trim()
  if (p.length === 0 || p.includes('\\') || p.includes('\0')) return null
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('~')) return null
  while (p.startsWith('./')) p = p.slice(2)
  const segments = p.split('/').filter((s) => s.length > 0 && s !== '.')
  if (segments.length === 0) return null
  if (segments.some((s) => s === '..')) return null
  return segments
}

/** The patterns from `patterns` that parseCopyPattern rejects (for save-time validation). */
export function invalidCopyPatterns(patterns: string[]): string[] {
  return patterns.filter((p) => parseCopyPattern(p) === null)
}

/** Compile one non-`**` segment (`*` and `?` wildcards) into an anchored matcher. */
export function segmentMatcher(segment: string): (name: string) => boolean {
  if (!/[*?]/.test(segment)) return (name) => name === segment
  const source = segment
    .split('')
    .map((ch) => {
      if (ch === '*') return '[^/]*'
      if (ch === '?') return '[^/]'
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  const re = new RegExp(`^${source}$`)
  return (name) => re.test(name)
}

export interface ExpandResult {
  /** Matched file paths relative to the root, `/`-separated, sorted, deduped. */
  files: string[]
  /** True when the entry budget ran out, so the list may be incomplete. */
  walkCapped: boolean
}

/**
 * Expand patterns against the injected directory tree. Invalid patterns are
 * ignored; skipped directories and non-regular entries are never matched.
 */
export async function expandCopyPatterns(
  patterns: string[],
  listDir: ListDir,
  limits: Pick<CopyLimits, 'maxEntries'> = DEFAULT_COPY_LIMITS
): Promise<ExpandResult> {
  const found = new Set<string>()
  const cache = new Map<string, DirEntry[]>()
  let budget = limits.maxEntries
  let walkCapped = false

  const list = async (dir: string): Promise<DirEntry[]> => {
    const cached = cache.get(dir)
    if (cached) return cached
    if (budget <= 0) {
      walkCapped = true
      return []
    }
    let entries: DirEntry[]
    try {
      entries = await listDir(dir)
    } catch {
      entries = []
    }
    if (entries.length > budget) {
      entries = entries.slice(0, budget)
      walkCapped = true
    }
    budget -= entries.length
    cache.set(dir, entries)
    return entries
  }
  const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)
  const usable = (e: DirEntry): boolean => !(e.kind === 'dir' && COPY_SKIP_DIRS.has(e.name))

  /** Every regular file under dir (a pattern named the directory itself). */
  const collectAll = async (dir: string): Promise<void> => {
    for (const e of await list(dir)) {
      if (!usable(e)) continue
      if (e.kind === 'file') found.add(join(dir, e.name))
      else if (e.kind === 'dir') await collectAll(join(dir, e.name))
    }
  }

  // (dir, segment index) pairs already expanded — `**` can reach the same
  // state along several routes.
  const visited = new Set<string>()
  const walk = async (dir: string, segments: string[], i: number): Promise<void> => {
    const state = `${i}\0${dir}`
    if (visited.has(state)) return
    visited.add(state)
    const segment = segments[i]
    const last = i === segments.length - 1
    if (segment === '**') {
      if (last) {
        await collectAll(dir)
        return
      }
      await walk(dir, segments, i + 1) // `**` matching zero directories
      for (const e of await list(dir)) {
        if (e.kind === 'dir' && usable(e)) await walk(join(dir, e.name), segments, i)
      }
      return
    }
    const matches = segmentMatcher(segment)
    for (const e of await list(dir)) {
      if (!usable(e) || !matches(e.name)) continue
      const rel = join(dir, e.name)
      if (last) {
        if (e.kind === 'file') found.add(rel)
        else if (e.kind === 'dir') await collectAll(rel)
      } else if (e.kind === 'dir') {
        await walk(rel, segments, i + 1)
      }
    }
  }

  for (const pattern of patterns) {
    const segments = parseCopyPattern(pattern)
    if (!segments) continue
    visited.clear()
    await walk('', segments, 0)
  }
  return { files: [...found].sort(), walkCapped }
}

export interface CopyCandidate {
  /** Path relative to the root, `/`-separated. */
  path: string
  size: number
}

export interface CopySelection {
  selected: CopyCandidate[]
  /** Candidates left out because a cap was reached. */
  overCap: number
}

/**
 * Take candidates in path order until the file-count cap, skipping any file
 * that would push the running total past the size cap (smaller later files
 * can still fit).
 */
export function selectCopyFiles(
  candidates: CopyCandidate[],
  limits: Pick<CopyLimits, 'maxFiles' | 'maxTotalBytes'> = DEFAULT_COPY_LIMITS
): CopySelection {
  const sorted = [...candidates].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const selected: CopyCandidate[] = []
  let total = 0
  let overCap = 0
  for (const c of sorted) {
    if (selected.length >= limits.maxFiles || total + c.size > limits.maxTotalBytes) {
      overCap++
      continue
    }
    selected.push(c)
    total += c.size
  }
  return { selected, overCap }
}
