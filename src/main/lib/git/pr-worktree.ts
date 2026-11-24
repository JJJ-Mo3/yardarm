/**
 * Worktree creation for a chat that works on an existing pull/merge request:
 * instead of branching a new `yardarm/…` branch from the base (worktree.ts
 * createWorktree), the PR's head is fetched and checked out.
 *
 * - Same-repo PR: fetch `origin/<head>` and check out a local branch of the
 *   same name tracking it, so a plain push updates the PR. An existing local
 *   branch is reused (fast-forwarded when possible).
 * - Fork PR, an unusable head branch name, a head branch already checked out
 *   elsewhere, or a failed branch fetch: fetch the forge's read-only head ref
 *   (`refs/pull/<n>/head`, `refs/merge-requests/<n>/head`) into a private ref
 *   and branch `yardarm/pr-<n>` from it.
 *
 * The branch name and number come from CLI output and are untrusted: the
 * number must be a positive integer and the name must pass isValidBranchName
 * and assertSafeRef before either reaches git argv.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { RepoProvider } from '../../../shared/ipc-types'
import { cliEnv } from './cli-path'
import { isPositiveInt, isValidBranchName, prHeadRef } from './issue-parse'
import { assertSafeRef } from './safe-ref'
import { uniqueBranch, worktreesRoot, type WorktreeInfo } from './worktree'

export interface PrCheckout {
  provider: RepoProvider
  number: number
  /** Source branch name reported by the forge (validated here). */
  headRefName: string
  /** True when the head lives in a fork (or that is unknown). */
  crossRepo: boolean
  /** Recorded as the chat's base branch (the PR target). */
  baseBranch: string
}

function git(cwd: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      // Never block on a credential prompt nobody can see.
      { cwd, timeout, env: { ...cliEnv(), GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message))
        else resolve(stdout)
      }
    )
  })
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], 10_000)
    return true
  } catch {
    return false
  }
}

/** Check out the PR's own head branch (same-repo PRs); null when that is not possible. */
async function checkoutHeadBranch(
  projectPath: string,
  worktreePath: string,
  head: string
): Promise<string | null> {
  const remoteRef = `refs/remotes/origin/${head}`
  try {
    await git(projectPath, ['fetch', 'origin', `+refs/heads/${head}:${remoteRef}`])
  } catch {
    return null
  }
  if (!(await refExists(projectPath, `refs/heads/${head}`))) {
    try {
      await git(projectPath, ['worktree', 'add', '--track', '-b', head, worktreePath, remoteRef])
      return head
    } catch {
      return null
    }
  }
  try {
    // Fails when the branch is already checked out in another working tree.
    await git(projectPath, ['worktree', 'add', worktreePath, head])
  } catch {
    return null
  }
  // Bring an older local copy up to the PR head when that is a fast-forward.
  await git(worktreePath, ['merge', '--ff-only', remoteRef]).catch(() => {})
  return head
}

/** Create the chat's worktree on the PR/MR head. */
export async function createPrWorktree(
  projectId: string,
  projectPath: string,
  chatId: string,
  pr: PrCheckout
): Promise<WorktreeInfo> {
  if (!isPositiveInt(pr.number)) throw new Error('Invalid pull request number')
  const worktreePath = path.join(worktreesRoot(), projectId, chatId)
  await fs.mkdir(path.dirname(worktreePath), { recursive: true })

  if (!pr.crossRepo && isValidBranchName(pr.headRefName)) {
    const head = assertSafeRef(pr.headRefName)
    const branch = await checkoutHeadBranch(projectPath, worktreePath, head)
    if (branch) return { worktreePath, branch, baseBranch: pr.baseBranch }
  }

  // Fork (or fallback): the forge exposes every PR head under a read-only ref.
  const localRef = `refs/yardarm/pr/${pr.number}`
  await git(projectPath, ['fetch', 'origin', `+${prHeadRef(pr.provider, pr.number)}:${localRef}`])
  const branch = await uniqueBranch(projectPath, `yardarm/pr-${pr.number}`)
  await git(projectPath, ['worktree', 'add', '--no-track', '-b', branch, worktreePath, localRef])
  return { worktreePath, branch, baseBranch: pr.baseBranch }
}
