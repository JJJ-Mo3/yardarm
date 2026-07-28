/**
 * Shared CLI resolution for repo-host CLIs (gh, glab). Binary paths are
 * resolved through a shell with the login PATH (so homebrew/nvm additions
 * apply in the packaged app) and then invoked directly by callers — never via
 * a shell — so user-provided input can't inject commands.
 */
import { spawn } from 'node:child_process'
import { getLoginPath } from '../system/login-path'

/** Child env with the login-shell PATH (homebrew etc.) merged in. */
export function cliEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: getLoginPath() ?? process.env.PATH }
}

function resolveCliPath(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(`command -v ${command}`, { shell: true, env: cliEnv() })
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

/**
 * Resolver for a CLI's absolute path (null if not installed). Hits are
 * cached; misses retry — the binary can become resolvable later (login-PATH
 * warm-up finishing, or the user installing it) without an app restart.
 */
export function makeCliResolver(command: string): () => Promise<string | null> {
  let pathPromise: Promise<string | null> | null = null
  return () => {
    pathPromise ??= resolveCliPath(command).then((p) => {
      if (p === null) pathPromise = null
      return p
    })
    return pathPromise
  }
}
