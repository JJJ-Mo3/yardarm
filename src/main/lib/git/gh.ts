/**
 * GitHub CLI (`gh`) integration: PR listing/creation for the Changes view and
 * review picker, plus CI check status, failed-log excerpts and auto-merge for
 * the details panel. The binary path is resolved through a shell (see cli-path.ts)
 * and then invoked directly — never via a shell — so user-provided
 * titles/bodies can't inject commands.
 */
import { execFile } from 'node:child_process'
import { cliEnv, makeCliResolver } from './cli-path'
import {
  excerptFailedLog,
  parseGhChecks,
  pickMergeMethod,
  type MergeMethod,
  type PrChecks
} from '../../../shared/pr-checks'

/** Absolute path to `gh`, or null if not installed. Hits are cached; misses retry. */
export const ghPath = makeCliResolver('gh')

/** An open PR/MR row for the review picker (GitLab MRs map onto this too). */
export interface PrSummary {
  number: number
  title: string
  headRefName: string
  author: string
}

/** Open PRs for the repo at cwd via `gh pr list`. */
export async function listPrs(cwd: string, limit = 20): Promise<PrSummary[]> {
  const gh = await ghPath()
  if (!gh) throw new Error('GitHub CLI (gh) not found — install it from https://cli.github.com')
  const args = ['pr', 'list', '--json', 'number,title,headRefName,author', '--limit', String(limit)]
  return new Promise((resolve, reject) => {
    execFile(gh, args, { cwd, timeout: 30_000, env: cliEnv() }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message))
        return
      }
      try {
        const raw = JSON.parse(stdout) as Array<{
          number: number
          title: string
          headRefName: string
          author?: { login?: string }
        }>
        resolve(
          raw.map((pr) => ({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            author: pr.author?.login ?? ''
          }))
        )
      } catch {
        reject(new Error('Unexpected gh pr list output'))
      }
    })
  })
}

/** The open PR for the branch checked out at cwd, or null if there is none. */
export async function prForBranch(
  cwd: string
): Promise<{ number: number; title: string; url: string } | null> {
  const gh = await ghPath()
  if (!gh) throw new Error('GitHub CLI (gh) not found — install it from https://cli.github.com')
  return new Promise((resolve, reject) => {
    execFile(
      gh,
      ['pr', 'view', '--json', 'number,title,url'],
      { cwd, timeout: 30_000, env: cliEnv() },
      (err, stdout, stderr) => {
        if (err) {
          // gh exits non-zero when the branch has no PR — that's a normal answer.
          if (/no pull requests? found/i.test(stderr)) resolve(null)
          else reject(new Error(stderr.trim() || err.message))
          return
        }
        try {
          const raw = JSON.parse(stdout) as { number: number; title: string; url: string }
          resolve({ number: raw.number, title: raw.title, url: raw.url })
        } catch {
          reject(new Error('Unexpected gh pr view output'))
        }
      }
    )
  })
}

/** A PR conversation entry (issue comment or review) for the details panel. */
export interface PrComment {
  author: string
  body: string
  /** ISO timestamp. */
  createdAt: string
  /** 'comment' for issue comments, review state (APPROVED/CHANGES_REQUESTED/…) for reviews. */
  kind: string
}

export interface PrConversation {
  number: number
  title: string
  url: string
  comments: PrComment[]
}

/**
 * PR conversation (issue comments + reviews, chronological) for the branch
 * checked out at cwd, or null when the branch has no PR.
 */
export async function prCommentsForBranch(cwd: string): Promise<PrConversation | null> {
  const gh = await ghPath()
  if (!gh) throw new Error('GitHub CLI (gh) not found — install it from https://cli.github.com')
  const args = ['pr', 'view', '--json', 'number,title,url,comments,reviews']
  return new Promise((resolve, reject) => {
    execFile(gh, args, { cwd, timeout: 30_000, env: cliEnv() }, (err, stdout, stderr) => {
      if (err) {
        // gh exits non-zero when the branch has no PR — that's a normal answer.
        if (/no pull requests? found/i.test(stderr)) resolve(null)
        else reject(new Error(stderr.trim() || err.message))
        return
      }
      try {
        const raw = JSON.parse(stdout) as {
          number: number
          title: string
          url: string
          comments?: Array<{ author?: { login?: string }; body?: string; createdAt?: string }>
          reviews?: Array<{
            author?: { login?: string }
            body?: string
            state?: string
            submittedAt?: string
          }>
        }
        const comments: PrComment[] = [
          ...(raw.comments ?? []).map((c) => ({
            author: c.author?.login ?? '',
            body: c.body ?? '',
            createdAt: c.createdAt ?? '',
            kind: 'comment'
          })),
          ...(raw.reviews ?? []).map((r) => ({
            author: r.author?.login ?? '',
            body: r.body ?? '',
            createdAt: r.submittedAt ?? '',
            kind: r.state ?? 'COMMENTED'
          }))
        ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        resolve({ number: raw.number, title: raw.title, url: raw.url, comments })
      } catch {
        reject(new Error('Unexpected gh pr view output'))
      }
    })
  })
}

export async function createPr(
  cwd: string,
  opts: { title: string; body: string; base?: string; draft?: boolean }
): Promise<{ url: string }> {
  const gh = await ghPath()
  if (!gh) throw new Error('GitHub CLI (gh) not found — install it from https://cli.github.com')
  const args = ['pr', 'create', '--title', opts.title, '--body', opts.body]
  if (opts.base) args.push('--base', opts.base)
  if (opts.draft) args.push('--draft')
  return new Promise((resolve, reject) => {
    execFile(gh, args, { cwd, timeout: 60_000, env: cliEnv() }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message))
      // gh prints the PR URL on the last stdout line.
      else resolve({ url: stdout.trim().split('\n').pop()?.trim() ?? '' })
    })
  })
}

const GH_MISSING = 'GitHub CLI (gh) not found — install it from https://cli.github.com'

/** Run gh and resolve with its outcome and output instead of rejecting. */
function runGh(
  gh: string,
  args: string[],
  cwd: string,
  timeout = 30_000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      gh,
      args,
      { cwd, timeout, env: cliEnv(), maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout, stderr: stderr.trim() || (err ? err.message : '') })
      }
    )
  })
}

/**
 * CI checks of the OPEN PR for the branch checked out at cwd; null when the
 * branch has no open PR. `gh pr checks` exits non-zero while checks are
 * failing or pending but still prints the JSON, so stdout decides.
 */
export async function prChecksForBranch(cwd: string): Promise<PrChecks | null> {
  const gh = await ghPath()
  if (!gh) throw new Error(GH_MISSING)
  const view = await runGh(
    gh,
    ['pr', 'view', '--json', 'number,title,url,state,autoMergeRequest'],
    cwd
  )
  if (!view.ok) {
    if (/no pull requests? found/i.test(view.stderr)) return null
    throw new Error(view.stderr)
  }
  let pr: { number: number; title: string; url: string; state?: string; autoMergeRequest?: unknown }
  try {
    pr = JSON.parse(view.stdout)
  } catch {
    throw new Error('Unexpected gh pr view output')
  }
  if (pr.state !== 'OPEN') return null
  const res = await runGh(gh, ['pr', 'checks', '--json', 'name,state,bucket,link,workflow'], cwd)
  let checks = parseGhChecks(res.stdout)
  if (!checks) {
    if (res.ok || /no checks reported/i.test(res.stderr)) checks = []
    else throw new Error(res.stderr || 'Unexpected gh pr checks output')
  }
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    autoMerge: !!pr.autoMergeRequest,
    checks
  }
}

/**
 * Tail excerpts of the failed step logs for the given Actions run ids.
 * Best-effort: runs whose logs can't be fetched quickly are skipped.
 */
export async function failedRunLogs(
  cwd: string,
  runIds: string[]
): Promise<Array<{ runId: string; excerpt: string }>> {
  const gh = await ghPath()
  if (!gh) return []
  const results = await Promise.all(
    runIds
      .filter((id) => /^\d+$/.test(id))
      .map(async (runId) => {
        const res = await runGh(gh, ['run', 'view', runId, '--log-failed'], cwd, 20_000)
        return { runId, excerpt: res.ok ? excerptFailedLog(res.stdout) : '' }
      })
  )
  return results.filter((r) => r.excerpt !== '')
}

/**
 * Enable auto-merge for the branch's PR using the repo's default merge
 * method. Rejects with gh's own message (e.g. when auto-merge is not enabled
 * for the repository).
 */
export async function enablePrAutoMerge(cwd: string): Promise<{ method: MergeMethod }> {
  const gh = await ghPath()
  if (!gh) throw new Error(GH_MISSING)
  const repo = await runGh(
    gh,
    [
      'repo',
      'view',
      '--json',
      'viewerDefaultMergeMethod,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed'
    ],
    cwd
  )
  const method = pickMergeMethod(repo.ok ? repo.stdout : '')
  const res = await runGh(gh, ['pr', 'merge', '--auto', `--${method}`], cwd, 60_000)
  if (!res.ok) throw new Error(res.stderr || 'gh pr merge failed')
  return { method }
}
