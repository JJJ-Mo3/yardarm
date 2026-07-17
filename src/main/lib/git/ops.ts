/**
 * Git operations for the Changes view and git client: status vs base,
 * per-file diffs, stage/unstage/discard, commit, push, branches, and
 * checkpoints (HEAD sha capture / hard reset for rollback).
 */
import { simpleGit } from 'simple-git'

export interface FileChange {
  path: string
  /** Two-char porcelain XY status, e.g. ' M', '??', 'A ' */
  status: string
  staged: boolean
}

export interface GitStatusResult {
  branch: string
  ahead: number
  behind: number
  files: FileChange[]
}

export async function gitStatus(cwd: string): Promise<GitStatusResult> {
  const git = simpleGit(cwd)
  const s = await git.status()
  const files: FileChange[] = s.files.map((f) => ({
    path: f.path,
    status: `${f.index}${f.working_dir}`,
    staged: f.index !== ' ' && f.index !== '?'
  }))
  return { branch: s.current ?? '', ahead: s.ahead, behind: s.behind, files }
}

export interface FileDiff {
  path: string
  oldContent: string
  newContent: string
  binary: boolean
}

/** Diff of one file: worktree contents vs a base ref (or HEAD). */
export async function fileDiff(cwd: string, filePath: string, baseRef?: string): Promise<FileDiff> {
  const git = simpleGit(cwd)
  const ref = baseRef ?? 'HEAD'
  let oldContent = ''
  try {
    oldContent = await git.show([`${ref}:${filePath}`])
  } catch {
    // new file
  }
  let newContent = ''
  let binary = false
  try {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const buf = await fs.readFile(path.join(cwd, filePath))
    if (buf.includes(0)) binary = true
    else newContent = buf.toString('utf8')
  } catch {
    // deleted file
  }
  return { path: filePath, oldContent, newContent, binary }
}

export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  await simpleGit(cwd).add(paths)
}

export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  await simpleGit(cwd).raw(['restore', '--staged', '--', ...paths])
}

export async function discardFiles(cwd: string, paths: string[]): Promise<void> {
  const git = simpleGit(cwd)
  const s = await git.status()
  const untracked = new Set(s.not_added)
  const toClean = paths.filter((p) => untracked.has(p))
  const toRestore = paths.filter((p) => !untracked.has(p))
  if (toRestore.length > 0) {
    await git.raw(['restore', '--worktree', '--staged', '--', ...toRestore]).catch(async () => {
      await git.raw(['checkout', '--', ...toRestore])
    })
  }
  if (toClean.length > 0) {
    await git.raw(['clean', '-f', '--', ...toClean])
  }
}

export async function commit(cwd: string, message: string, stageAll: boolean): Promise<string> {
  const git = simpleGit(cwd)
  if (stageAll) await git.add(['-A'])
  const res = await git.commit(message)
  return res.commit
}

export async function push(cwd: string): Promise<void> {
  const git = simpleGit(cwd)
  const s = await git.status()
  const branch = s.current
  if (!branch) throw new Error('Not on a branch')
  if (s.tracking) await git.push()
  else await git.push(['-u', 'origin', branch])
}

export async function listBranches(cwd: string): Promise<{ current: string; all: string[] }> {
  const b = await simpleGit(cwd).branchLocal()
  return { current: b.current, all: b.all }
}

export async function gitLog(
  cwd: string,
  limit = 50
): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
  const log = await simpleGit(cwd).log({ maxCount: limit })
  return log.all.map((c) => ({
    hash: c.hash,
    message: c.message,
    author: c.author_name,
    date: c.date
  }))
}

// ---- Checkpoints ----------------------------------------------------------

/**
 * Capture a checkpoint before a user message: HEAD sha plus a stash commit
 * capturing uncommitted changes (if any). Encoded as JSON string.
 */
export async function captureCheckpoint(cwd: string): Promise<string | null> {
  try {
    const git = simpleGit(cwd)
    const head = (await git.revparse(['HEAD'])).trim()
    let stash: string | null = null
    try {
      const out = (await git.raw(['stash', 'create'])).trim()
      if (out) {
        stash = out
        // Keep the dangling commit alive against GC.
        await git.raw(['update-ref', `refs/codezero/checkpoints/${stash}`, stash]).catch(() => {})
      }
    } catch {
      // clean tree or stash unsupported
    }
    return JSON.stringify({ head, stash })
  } catch {
    return null
  }
}

/** Restore worktree files to a previously captured checkpoint. */
export async function restoreCheckpoint(cwd: string, checkpointRef: string): Promise<void> {
  const { head, stash } = JSON.parse(checkpointRef) as { head: string; stash: string | null }
  const git = simpleGit(cwd)
  await git.raw(['reset', '--hard', head])
  await git.raw(['clean', '-fd'])
  if (stash) {
    await git.raw(['stash', 'apply', stash]).catch((err) => {
      console.error('[checkpoint] stash apply failed', err)
    })
  }
}
