/**
 * GitHub CLI (`gh`) integration: detection + PR creation for the Changes view.
 * The binary path is resolved once through a shell (so homebrew/nvm PATH
 * additions apply in the packaged app) and then invoked directly — never via
 * a shell — so user-provided titles/bodies can't inject commands.
 */
import { execFile, spawn } from 'node:child_process'
import { getLoginPath } from '../system/login-path'

let ghPathPromise: Promise<string | null> | null = null

/** Child env with the login-shell PATH (homebrew etc.) merged in. */
function ghEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: getLoginPath() ?? process.env.PATH }
}

function resolveGhPath(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn('command -v gh', { shell: true, env: ghEnv() })
      let out = ''
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // ignore
        }
        resolve(null)
      }, 5000)
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      child.on('error', () => {
        clearTimeout(timer)
        resolve(null)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const p = out.trim().split('\n')[0]?.trim()
        resolve(code === 0 && p ? p : null)
      })
    } catch {
      resolve(null)
    }
  })
}

/** Absolute path to `gh`, or null if not installed. Hits are cached; misses retry. */
export function ghPath(): Promise<string | null> {
  ghPathPromise ??= resolveGhPath().then((p) => {
    // Don't cache misses forever: gh can become resolvable later (login-PATH
    // warm-up finishing, or the user installing it) without an app restart.
    if (p === null) ghPathPromise = null
    return p
  })
  return ghPathPromise
}

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
    execFile(gh, args, { cwd, timeout: 30_000, env: ghEnv() }, (err, stdout, stderr) => {
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
      { cwd, timeout: 30_000, env: ghEnv() },
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
    execFile(gh, args, { cwd, timeout: 60_000, env: ghEnv() }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message))
      // gh prints the PR URL on the last stdout line.
      else resolve({ url: stdout.trim().split('\n').pop()?.trim() ?? '' })
    })
  })
}
