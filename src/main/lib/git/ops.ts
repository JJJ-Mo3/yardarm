/**
 * Git operations for the Changes view and git client: status vs base,
 * per-file diffs, stage/unstage/discard, commit, push, pull, branches,
 * merging a worktree branch into the base branch at the project root,
 * commit history (per-commit files + diffs), per-hunk revert, and
 * checkpoints (HEAD sha capture / hard reset for rollback).
 */
import { simpleGit } from 'simple-git'
import { spawn } from 'node:child_process'
import { assertSafeRef, resolveInside } from './safe-ref'
import {
  buildSingleHunkPatch,
  describeHunks,
  hunkHash,
  isRevertablePatch,
  parseFilePatch,
  type HunkInfo,
  type ParsedFilePatch
} from './hunk-patch'
import { randomUUID } from 'crypto'
import { rm } from 'fs/promises'
import os from 'os'
import path from 'path'

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
  const ref = assertSafeRef(baseRef ?? 'HEAD')
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
    const buf = await fs.readFile(resolveInside(cwd, filePath))
    if (buf.includes(0)) binary = true
    else newContent = buf.toString('utf8')
  } catch {
    // deleted file
  }
  return { path: filePath, oldContent, newContent, binary }
}

/**
 * Run git with an argv array (never a shell), optionally feeding stdin.
 * Output is decoded as latin1 so patch bytes survive a round trip unchanged.
 */
function runGitRaw(cwd: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const errOut: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => errOut.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('latin1'))
      else reject(new Error(Buffer.concat(errOut).toString('utf8').trim() || `git exited ${code}`))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(stdin === undefined ? undefined : Buffer.from(stdin, 'latin1'))
  })
}

/** The parsed worktree-vs-ref diff of one file (the diff the Changes view shows). */
async function readFilePatch(
  cwd: string,
  filePath: string,
  baseRef?: string
): Promise<ParsedFilePatch> {
  const ref = assertSafeRef(baseRef ?? 'HEAD')
  resolveInside(cwd, filePath)
  const out = await runGitRaw(cwd, [
    '--literal-pathspecs',
    'diff',
    '--no-ext-diff',
    '--no-color',
    '--no-textconv',
    '--no-renames',
    '--relative',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    ref,
    '--',
    filePath
  ])
  return parseFilePatch(out)
}

/**
 * Hunks of one file's worktree-vs-ref diff that can be reverted individually.
 * Empty for untracked/new files, binary files and unreadable diffs.
 */
export async function fileHunks(
  cwd: string,
  filePath: string,
  baseRef?: string
): Promise<HunkInfo[]> {
  try {
    const patch = await readFilePatch(cwd, filePath, baseRef)
    return isRevertablePatch(patch) ? describeHunks(patch) : []
  } catch {
    return []
  }
}

/**
 * Discard one hunk of a file's worktree changes: rebuild the diff the view
 * showed, cut out that hunk, and apply it in reverse to the working tree.
 * `hash` must match the hunk's current content, so a view that went stale
 * can never revert a different change. When the view compares against HEAD
 * the reverse is also applied to the index where it fits (the change was
 * staged), so a reverted hunk does not linger as a staged change; against
 * any other base only the working tree is touched.
 */
export async function revertHunk(
  cwd: string,
  filePath: string,
  opts: { index: number; hash: string; baseRef?: string }
): Promise<void> {
  const patch = await readFilePatch(cwd, filePath, opts.baseRef)
  if (!isRevertablePatch(patch)) throw new Error('This file has no change that can be reverted')
  const hunk = patch.hunks[opts.index]
  const single = buildSingleHunkPatch(patch, opts.index)
  if (!hunk || !single || hunkHash(hunk) !== opts.hash) {
    throw new Error('The file changed since this diff was shown — refresh and try again')
  }
  const apply = ['apply', '-R', '--whitespace=nowarn']
  try {
    await runGitRaw(cwd, [...apply, '-'], single)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not revert this change: ${msg}`)
  }
  if (!opts.baseRef) {
    // Best-effort: fails cleanly (and changes nothing) when the hunk isn't staged.
    await runGitRaw(cwd, [...apply, '--cached', '-'], single).catch(() => {})
  }
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

export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  assertSafeRef(branch)
  await simpleGit(cwd).checkout(branch)
}

/** Stash all working-tree changes (including untracked files). */
export async function stashPush(cwd: string, message: string): Promise<void> {
  await simpleGit(cwd).raw(['stash', 'push', '-u', '-m', message])
}

/** Create a new branch from HEAD and switch to it. */
export async function createBranch(cwd: string, branch: string): Promise<void> {
  assertSafeRef(branch)
  await simpleGit(cwd).checkoutLocalBranch(branch)
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

/**
 * Pull the current branch from its upstream. Conflicted pulls are aborted so
 * the working tree is never left mid-merge.
 */
export async function pull(cwd: string): Promise<void> {
  const git = simpleGit(cwd)
  const s = await git.status()
  if (!s.current) throw new Error('Not on a branch')
  if (!s.tracking) throw new Error(`No upstream configured for ${s.current} — push it first`)
  try {
    await git.pull()
  } catch (err) {
    // Abort any half-applied merge or rebase, best-effort.
    const hasMergeHead = await git
      .raw(['rev-parse', '--verify', '-q', 'MERGE_HEAD'])
      .then(() => true)
      .catch(() => false)
    if (hasMergeHead) await git.raw(['merge', '--abort']).catch(() => {})
    else await git.raw(['rebase', '--abort']).catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Pull failed (any partial merge was aborted): ${msg}`)
  }
}

/**
 * Merge a worktree branch into the base branch. Runs at the PROJECT ROOT,
 * where the base branch is checked out (git forbids checking it out in the
 * chat worktree). Conflicted merges are aborted so the base stays unchanged.
 */
export async function mergeIntoBase(
  projectPath: string,
  branch: string,
  baseBranch: string,
  opts: { squash: boolean; message?: string }
): Promise<{ sha: string }> {
  assertSafeRef(branch)
  assertSafeRef(baseBranch)
  const git = simpleGit(projectPath)
  const s = await git.status()
  if (s.current !== baseBranch) {
    throw new Error(
      `Cannot merge: the project folder has '${s.current ?? '(detached)'}' checked out, not base '${baseBranch}'`
    )
  }
  const hasTrackedChanges = s.files.some((f) => f.working_dir !== '?' || f.index !== '?')
  if (hasTrackedChanges) {
    throw new Error(
      `Cannot merge: uncommitted changes on base '${baseBranch}' — commit or stash first`
    )
  }
  await git.raw(['rev-parse', '--verify', `refs/heads/${branch}`]).catch(() => {
    throw new Error(`Branch '${branch}' not found`)
  })
  const count = (await git.raw(['rev-list', '--count', `${baseBranch}..${branch}`])).trim()
  if (count === '0')
    throw new Error(`Nothing to merge: '${branch}' has no commits ahead of '${baseBranch}'`)
  const message = opts.message?.trim() || `Merge ${branch}`
  try {
    if (opts.squash) {
      await git.raw(['merge', '--squash', branch])
      await git.commit(message)
    } else {
      await git.raw(['merge', '--no-ff', '-m', message, branch])
    }
  } catch (err) {
    // Squash conflicts leave no MERGE_HEAD, so try both cleanups best-effort.
    await git.raw(['merge', '--abort']).catch(() => {})
    await git.raw(['reset', '--merge']).catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Merge failed and was aborted — '${baseBranch}' is unchanged. ${msg}`)
  }
  const sha = (await git.revparse(['HEAD'])).trim()
  return { sha }
}

export interface CommitFileChange {
  path: string
  /** One-letter status: M, A, D, R, C, T... */
  status: string
}

/** Parse `git show --name-status` output into per-file changes. */
export function parseNameStatus(out: string): CommitFileChange[] {
  const changes: CommitFileChange[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const status = parts[0][0]
    // Renames/copies list old\tnew — report the new path.
    const path = parts[parts.length - 1]
    changes.push({ path, status })
  }
  return changes
}

/** Files changed by a commit (first parent for merges; handles root commits). */
export async function commitFiles(cwd: string, hash: string): Promise<CommitFileChange[]> {
  assertSafeRef(hash)
  const out = await simpleGit(cwd).raw([
    'show',
    hash,
    '--name-status',
    '--format=',
    '--first-parent',
    '-m',
    '--root'
  ])
  return parseNameStatus(out)
}

/** Diff of one file within a commit: parent's version vs the commit's. */
export async function commitFileDiff(
  cwd: string,
  hash: string,
  filePath: string
): Promise<FileDiff> {
  assertSafeRef(hash)
  const git = simpleGit(cwd)
  let oldContent = ''
  try {
    oldContent = await git.show([`${hash}^:${filePath}`])
  } catch {
    // added in this commit, or root commit
  }
  let newContent = ''
  try {
    newContent = await git.show([`${hash}:${filePath}`])
  } catch {
    // deleted in this commit
  }
  const binary = oldContent.includes('\u0000') || newContent.includes('\u0000')
  if (binary) return { path: filePath, oldContent: '', newContent: '', binary }
  return { path: filePath, oldContent, newContent, binary }
}

/** Merge base of a ref and HEAD (null when the ref is unknown/unrelated). */
export async function mergeBase(cwd: string, ref: string): Promise<string | null> {
  try {
    return (await simpleGit(cwd).raw(['merge-base', assertSafeRef(ref), 'HEAD'])).trim() || null
  } catch {
    return null
  }
}

/** Files changed between a base ref and the worktree (`git diff --name-status`). */
export async function diffNameStatus(cwd: string, baseRef: string): Promise<CommitFileChange[]> {
  const out = await simpleGit(cwd).raw(['diff', '--name-status', assertSafeRef(baseRef)])
  return parseNameStatus(out)
}

// ---- Checkpoints ----------------------------------------------------------

/**
 * Capture a checkpoint before a user message: HEAD sha plus a stash-like
 * commit capturing uncommitted changes (if any). Encoded as JSON string.
 *
 * The stash commit is built by hand from a temporary index (never touching
 * the real index or working tree) because `git stash create` skips untracked
 * files — and restoreCheckpoint's `clean -fd` would then permanently delete
 * untracked files that existed before the message. The two-parent shape
 * (HEAD + an index commit) is what `git stash apply` requires.
 */
export async function captureCheckpoint(cwd: string): Promise<string | null> {
  try {
    const git = simpleGit(cwd)
    const head = (await git.revparse(['HEAD'])).trim()
    let stash: string | null = null
    const tmpIndex = path.join(os.tmpdir(), `yardarm-ckpt-index-${randomUUID()}`)
    try {
      const envGit = simpleGit(cwd).env({ ...process.env, GIT_INDEX_FILE: tmpIndex })
      await envGit.raw(['read-tree', head])
      // Stages modified + untracked (gitignore respected), temp index only.
      await envGit.raw(['add', '-A'])
      const tree = (await envGit.raw(['write-tree'])).trim()
      const headTree = (await git.revparse([`${head}^{tree}`])).trim()
      if (tree !== headTree) {
        const indexCommit = (
          await envGit.raw(['commit-tree', headTree, '-p', head, '-m', 'yardarm checkpoint index'])
        ).trim()
        stash = (
          await envGit.raw([
            'commit-tree',
            tree,
            '-p',
            head,
            '-p',
            indexCommit,
            '-m',
            'yardarm checkpoint'
          ])
        ).trim()
        // Keep the dangling commit alive against GC.
        await git.raw(['update-ref', `refs/yardarm/checkpoints/${stash}`, stash]).catch(() => {})
      }
    } catch {
      // clean tree or capture unsupported
    } finally {
      await rm(tmpIndex, { force: true }).catch(() => {})
    }
    return JSON.stringify({ head, stash })
  } catch {
    return null
  }
}

/** Stash shas currently pinned under refs/yardarm/checkpoints. */
export async function listCheckpointRefs(cwd: string): Promise<string[]> {
  try {
    const out = await simpleGit(cwd).raw([
      'for-each-ref',
      '--format=%(refname)',
      'refs/yardarm/checkpoints'
    ])
    return out
      .split('\n')
      .map((l) => l.trim().replace('refs/yardarm/checkpoints/', ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Files changed between two refs (`git diff --name-status A B`). */
export async function diffRefs(
  cwd: string,
  refA: string,
  refB: string
): Promise<CommitFileChange[]> {
  const out = await simpleGit(cwd).raw([
    'diff',
    '--name-status',
    assertSafeRef(refA),
    assertSafeRef(refB)
  ])
  return parseNameStatus(out)
}

/** Diff of one file between two refs: refA's version vs refB's. */
export async function refFileDiff(
  cwd: string,
  refA: string,
  refB: string,
  filePath: string
): Promise<FileDiff> {
  assertSafeRef(refA)
  assertSafeRef(refB)
  const git = simpleGit(cwd)
  let oldContent = ''
  try {
    oldContent = await git.show([`${refA}:${filePath}`])
  } catch {
    // absent in refA
  }
  let newContent = ''
  try {
    newContent = await git.show([`${refB}:${filePath}`])
  } catch {
    // absent in refB
  }
  const binary = oldContent.includes('\u0000') || newContent.includes('\u0000')
  if (binary) return { path: filePath, oldContent: '', newContent: '', binary }
  return { path: filePath, oldContent, newContent, binary }
}

/**
 * Delete checkpoint keep-alive refs so the pinned stash commits become
 * garbage-collectable. Best-effort: missing refs are ignored.
 */
export async function deleteCheckpointRefs(cwd: string, stashShas: string[]): Promise<void> {
  if (stashShas.length === 0) return
  try {
    const git = simpleGit(cwd)
    for (const sha of stashShas) {
      await git.raw(['update-ref', '-d', `refs/yardarm/checkpoints/${sha}`]).catch(() => {})
    }
  } catch {
    // best effort
  }
}

/** Extract the stash sha (if any) from a captureCheckpoint() JSON string. */
export function checkpointStashSha(checkpointRef: string): string | null {
  try {
    const parsed = JSON.parse(checkpointRef) as { stash?: string | null }
    return parsed.stash ?? null
  } catch {
    return null
  }
}

/**
 * Restore worktree files to a previously captured checkpoint. Returns a
 * warning when the restore was only partial (the snapshot's uncommitted
 * changes could not be re-applied) so the UI can tell the user, plus the
 * files the revert touched (so the agent can be told what changed).
 */
export async function restoreCheckpoint(
  cwd: string,
  checkpointRef: string
): Promise<{ warning: string | null; changedFiles: string[] }> {
  const { head, stash } = JSON.parse(checkpointRef) as { head: string; stash: string | null }
  assertSafeRef(head)
  if (stash) assertSafeRef(stash)
  const git = simpleGit(cwd)
  // Measured before the reset: tracked files differing from the checkpoint
  // head plus untracked files (which `clean -fd` removes). Best-effort.
  let changedFiles: string[] = []
  try {
    const changed = (await git.raw(['diff', '--name-only', head])).trim()
    const untracked = (await git.raw(['ls-files', '--others', '--exclude-standard'])).trim()
    changedFiles = [...new Set([...changed.split('\n'), ...untracked.split('\n')])].filter(Boolean)
  } catch {
    // informational only
  }
  await git.raw(['reset', '--hard', head])
  await git.raw(['clean', '-fd'])
  if (stash) {
    try {
      await git.raw(['stash', 'apply', stash])
    } catch (err) {
      console.error('[checkpoint] stash apply failed', err)
      const reason = (err instanceof Error ? err.message : String(err)).split('\n')[0]
      return {
        warning: `Committed files were restored, but the snapshot's uncommitted changes could not be re-applied (${reason}).`,
        changedFiles
      }
    }
  }
  return { warning: null, changedFiles }
}
