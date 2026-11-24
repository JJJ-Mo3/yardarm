/**
 * Issue and pull/merge-request lookups for "start a chat from an issue or
 * PR", through the gh / glab CLIs. The binaries are invoked directly with
 * argument arrays (never a shell) and every number that reaches argv is
 * checked to be a positive integer first. Output parsing is in
 * issue-parse.ts.
 */
import { execFile } from 'node:child_process'
import type { RepoProvider } from '../../../shared/ipc-types'
import { cliEnv } from './cli-path'
import { ghPath } from './gh'
import { glabPath } from './glab'
import {
  isPositiveInt,
  parseGhIssue,
  parseGhIssueList,
  parseGhPrHead,
  parseGlabIssue,
  parseGlabIssueList,
  parseGlabMrHead,
  type IssueDetail,
  type IssueSummary,
  type PrHead
} from './issue-parse'

async function cliFor(provider: RepoProvider): Promise<string> {
  if (provider === 'gitlab') {
    const glab = await glabPath()
    if (!glab) {
      throw new Error(
        'GitLab CLI (glab) not found — install it from https://gitlab.com/gitlab-org/cli'
      )
    }
    return glab
  }
  const gh = await ghPath()
  if (!gh) throw new Error('GitHub CLI (gh) not found — install it from https://cli.github.com')
  return gh
}

function run(bin: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd, timeout: 30_000, env: cliEnv(), maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message))
        else resolve(stdout)
      }
    )
  })
}

function assertNumber(number: number): string {
  if (!isPositiveInt(number)) throw new Error('Invalid issue or pull request number')
  return String(number)
}

/** Open issues of the repo at cwd, most recently updated first as the CLI returns them. */
export async function listIssues(
  cwd: string,
  provider: RepoProvider,
  limit = 50
): Promise<IssueSummary[]> {
  const bin = await cliFor(provider)
  const count = String(Math.max(1, Math.min(100, Math.trunc(limit))))
  if (provider === 'gitlab') {
    return parseGlabIssueList(
      await run(bin, ['issue', 'list', '--output', 'json', '--per-page', count], cwd)
    )
  }
  return parseGhIssueList(
    await run(
      bin,
      [
        'issue',
        'list',
        '--state',
        'open',
        '--json',
        'number,title,author,url,labels,updatedAt',
        '--limit',
        count
      ],
      cwd
    )
  )
}

/** One issue with its body. */
export async function getIssue(
  cwd: string,
  provider: RepoProvider,
  number: number
): Promise<IssueDetail> {
  const bin = await cliFor(provider)
  const n = assertNumber(number)
  if (provider === 'gitlab') {
    return parseGlabIssue(await run(bin, ['issue', 'view', n, '--output', 'json'], cwd))
  }
  return parseGhIssue(
    await run(bin, ['issue', 'view', n, '--json', 'number,title,body,url,author'], cwd)
  )
}

/** Head/base branch info for one pull/merge request. */
export async function getPrHead(
  cwd: string,
  provider: RepoProvider,
  number: number
): Promise<PrHead> {
  const bin = await cliFor(provider)
  const n = assertNumber(number)
  if (provider === 'gitlab') {
    return parseGlabMrHead(await run(bin, ['mr', 'view', n, '--output', 'json'], cwd))
  }
  return parseGhPrHead(
    await run(
      bin,
      ['pr', 'view', n, '--json', 'number,title,url,headRefName,baseRefName,isCrossRepository'],
      cwd
    )
  )
}
