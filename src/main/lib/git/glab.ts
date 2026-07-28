/**
 * GitLab CLI (`glab`) integration: MR listing/creation, mirroring gh.ts. The
 * binary path is resolved through a shell (see cli-path.ts) and then invoked
 * directly — never via a shell — so user-provided titles/bodies can't inject
 * commands. MRs are mapped onto the shared PrSummary shape (`number` = MR iid).
 */
import { execFile } from 'node:child_process'
import { cliEnv, makeCliResolver } from './cli-path'
import type { PrSummary } from './gh'

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
