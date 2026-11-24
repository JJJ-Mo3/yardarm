/**
 * Copies untracked project files (.env.local and friends) into a freshly
 * created chat worktree, driven by the "copy-files" glob list in
 * .yardarm/worktree.json. Callers must only pass patterns the user approved
 * (isSetupTrusted) — the list comes from a repo file.
 *
 * Safety: patterns are expanded by copy-files.ts (root-relative only, no
 * symlinks, never into .git / node_modules), files git tracks are left to git,
 * an existing destination is never overwritten, a destination whose parent
 * chain passes through a symlink is skipped, and the number and total size of
 * copied files are capped.
 */
import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_COPY_LIMITS,
  expandCopyPatterns,
  selectCopyFiles,
  type CopyCandidate,
  type CopyLimits,
  type DirEntry
} from './copy-files'
import { resolveInside } from './safe-ref'

export interface CopyReport {
  /** Root-relative paths that were copied. */
  copied: string[]
  /** Files left alone because the worktree already had that path. */
  skippedExisting: number
  /** Matching files left out because a cap (count, size, or scan budget) was hit. */
  capped: boolean
  /** Files that matched but could not be copied (unreadable, unsafe destination). */
  failed: number
}

/** `git ls-files` over the given root-relative paths → the tracked subset. */
function trackedPaths(projectPath: string, relPaths: string[]): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      // Literal pathspecs: a file name is never interpreted as a glob or `:magic`.
      ['--literal-pathspecs', 'ls-files', '-z', '--', ...relPaths],
      { cwd: projectPath, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err)
        else resolve(new Set(stdout.split('\0').filter((p) => p.length > 0)))
      }
    )
  })
}

/** True when any existing directory between root and the file's parent is a symlink. */
async function parentChainHasSymlink(root: string, relPath: string): Promise<boolean> {
  const parts = relPath.split('/').slice(0, -1)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) return true
    } catch {
      return false // does not exist yet — mkdir will create real directories
    }
  }
  return false
}

/**
 * Copy the untracked files matching `patterns` from the project folder to the
 * same relative paths in the worktree. Best-effort: never throws.
 */
export async function copyUntrackedFiles(
  projectPath: string,
  worktreePath: string,
  patterns: string[],
  limits: CopyLimits = DEFAULT_COPY_LIMITS
): Promise<CopyReport> {
  const report: CopyReport = { copied: [], skippedExisting: 0, capped: false, failed: 0 }
  if (patterns.length === 0) return report
  try {
    const listDir = async (relDir: string): Promise<DirEntry[]> => {
      const dirents = await fs.readdir(resolveInside(projectPath, relDir), { withFileTypes: true })
      // Dirent types come from lstat, so a symlink is 'other' and never followed.
      return dirents.map((d) => ({
        name: d.name,
        kind: d.isFile() ? 'file' : d.isDirectory() ? 'dir' : 'other'
      }))
    }
    const expanded = await expandCopyPatterns(patterns, listDir, limits)
    if (expanded.walkCapped) report.capped = true
    if (expanded.files.length === 0) return report

    // Tracked files belong to git (the worktree checkout already has the
    // right version) — only untracked ones are copied.
    const tracked = new Set<string>()
    for (let i = 0; i < expanded.files.length; i += 200) {
      const chunk = expanded.files.slice(i, i + 200)
      for (const p of await trackedPaths(projectPath, chunk)) tracked.add(p)
    }

    const candidates: CopyCandidate[] = []
    for (const rel of expanded.files) {
      if (tracked.has(rel)) continue
      try {
        const stat = await fs.lstat(resolveInside(projectPath, rel))
        if (stat.isFile()) candidates.push({ path: rel, size: stat.size })
      } catch {
        report.failed++
      }
    }
    const { selected, overCap } = selectCopyFiles(candidates, limits)
    if (overCap > 0) report.capped = true

    for (const { path: rel } of selected) {
      try {
        const src = resolveInside(projectPath, rel)
        const dest = resolveInside(worktreePath, rel)
        if (await parentChainHasSymlink(worktreePath, rel)) {
          report.failed++
          continue
        }
        await fs.mkdir(path.dirname(dest), { recursive: true })
        // COPYFILE_EXCL: fail rather than overwrite a file the checkout has.
        await fs.copyFile(src, dest, fsConstants.COPYFILE_EXCL)
        report.copied.push(rel)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') report.skippedExisting++
        else report.failed++
      }
    }
  } catch (err) {
    console.error('[worktree] copying untracked files failed', err)
    report.failed++
  }
  return report
}
