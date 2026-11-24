/**
 * GitLab CLI (`glab`) integration: MR listing/creation, pipeline job status
 * and auto-merge, mirroring gh.ts. The
 * binary path is resolved through a shell (see cli-path.ts) and then invoked
 * directly — never via a shell — so user-provided titles/bodies can't inject
 * commands. MRs are mapped onto the shared PrSummary shape (`number` = MR iid).
 */
import { execFile } from 'node:child_process'
import { cliEnv, makeCliResolver } from './cli-path'
import type { PrSummary } from './gh'
import {
  gitlabPipelineCheck,
  parseGitlabJobs,
  parseGitlabMr,
  type PrChecks
} from '../../../shared/pr-checks'

/** Absolute path to `glab`, or null if not installed. Hits are cached; misses retry. */
export const glabPath = makeCliResolver('glab')

const NOT_INSTALLED =
  'GitLab CLI (glab) not found — install it from https://gitlab.com/gitlab-org/cli'

/** Open MRs for the repo at cwd via `glab mr list`. */
export async function listMrs(cwd: string, limit = 20): Promise<PrSummary[]> {
  const glab = await glabPath()
  if (!glab) throw new Error(NOT_INSTALLED)
  const args = ['mr', 'list', '--output', 'json', '--per-page', String(limit)]
  return new Promise((resolve, reject) => {
    execFile(glab, args, { cwd, timeout: 30_000, env: cliEnv() }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message))
        return
      }
      try {
        const raw = JSON.parse(stdout) as Array<{
          iid: number
          title: string
          source_branch: string
          author?: { username?: string }
        }>
        resolve(
          raw.map((mr) => ({
            number: mr.iid,
            title: mr.title,
            headRefName: mr.source_branch,
            author: mr.author?.username ?? ''
          }))
        )
      } catch {
        reject(new Error('Unexpected glab mr list output'))
      }
    })
  })
}

/** The open MR for the branch checked out at cwd, or null if there is none. */
export async function mrForBranch(
  cwd: string
): Promise<{ number: number; title: string; url: string } | null> {
  const glab = await glabPath()
  if (!glab) throw new Error(NOT_INSTALLED)
  return new Promise((resolve, reject) => {
    execFile(
      glab,
      ['mr', 'view', '--output', 'json'],
      { cwd, timeout: 30_000, env: cliEnv() },
      (err, stdout, stderr) => {
        if (err) {
          // glab exits non-zero when the branch has no MR — that's a normal answer.
          if (/no open merge request/i.test(stderr)) resolve(null)
          else reject(new Error(stderr.trim() || err.message))
          return
        }
        try {
          const raw = JSON.parse(stdout) as { iid: number; title: string; web_url: string }
          resolve({ number: raw.iid, title: raw.title, url: raw.web_url })
        } catch {
          reject(new Error('Unexpected glab mr view output'))
        }
      }
    )
  })
}

export async function createMr(
  cwd: string,
  opts: { title: string; body: string; base?: string; draft?: boolean }
): Promise<{ url: string }> {
  const glab = await glabPath()
  if (!glab) throw new Error(NOT_INSTALLED)
  // --yes skips the interactive submission prompt (glab is interactive by default).
  const args = ['mr', 'create', '--title', opts.title, '--description', opts.body, '--yes']
  if (opts.base) args.push('--target-branch', opts.base)
  if (opts.draft) args.push('--draft')
  return new Promise((resolve, reject) => {
    execFile(glab, args, { cwd, timeout: 60_000, env: cliEnv() }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message))
        return
      }
      // glab prints status lines around the MR URL; take the last URL in stdout.
      const urls = stdout.match(/https?:\/\/\S+/g)
      resolve({ url: urls?.[urls.length - 1] ?? '' })
    })
  })
}

/** Run glab and resolve with its outcome and output instead of rejecting. */
function runGlab(
  glab: string,
  args: string[],
  cwd: string,
  timeout = 30_000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      glab,
      args,
      { cwd, timeout, env: cliEnv(), maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout, stderr: stderr.trim() || (err ? err.message : '') })
      }
    )
  })
}

/**
 * CI jobs of the head pipeline of the OPEN MR for the branch checked out at
 * cwd; null when the branch has no open MR. Jobs come from the pipeline-jobs
 * REST endpoint via `glab api`; when that fails the pipeline itself is shown
 * as a single row.
 */
export async function mrChecksForBranch(cwd: string): Promise<PrChecks | null> {
  const glab = await glabPath()
  if (!glab) throw new Error(NOT_INSTALLED)
  const view = await runGlab(glab, ['mr', 'view', '--output', 'json'], cwd)
  if (!view.ok) {
    if (/no open merge request/i.test(view.stderr)) return null
    throw new Error(view.stderr)
  }
  const mr = parseGitlabMr(view.stdout)
  if (!mr) throw new Error('Unexpected glab mr view output')
  if (!mr.open) return null
  let checks: PrChecks['checks'] = []
  if (mr.pipeline) {
    // `:id` is glab's placeholder for the current project; fork MRs name theirs.
    const project = mr.pipeline.projectId ?? ':id'
    const jobs = await runGlab(
      glab,
      ['api', `projects/${project}/pipelines/${mr.pipeline.id}/jobs?per_page=100`],
      cwd
    )
    checks = (jobs.ok ? parseGitlabJobs(jobs.stdout) : null) ?? [gitlabPipelineCheck(mr.pipeline)]
  }
  return { number: mr.number, title: mr.title, url: mr.url, autoMerge: mr.autoMerge, checks }
}

/**
 * Set the branch's MR to merge automatically once its pipeline succeeds
 * (project default merge method). Rejects with glab's own message.
 */
export async function enableMrAutoMerge(cwd: string): Promise<void> {
  const glab = await glabPath()
  if (!glab) throw new Error(NOT_INSTALLED)
  const res = await runGlab(glab, ['mr', 'merge', '--auto-merge', '--yes'], cwd, 60_000)
  if (!res.ok) throw new Error(res.stderr || 'glab mr merge failed')
}
