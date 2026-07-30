/**
 * Login-shell PATH + environment capture. Packaged GUI apps launch with the
 * bare launchd environment (/usr/bin:/bin PATH, no shell exports), so
 * anything the user configured in ~/.zprofile etc. is invisible to processes
 * we spawn — notably the LSP language servers behind the IDE problems panel
 * (PATH) and provider API keys exported as environment variables. The user's
 * real environment only exists in login shells, so it's captured once from
 * one and consulted when building child-process environments. The captured
 * map lives in main-process memory only — it is never persisted or sent to
 * the renderer.
 */
import { execFile } from 'node:child_process'

let loginPath: string | undefined
let loginEnv: Record<string, string> | undefined
let warmPromise: Promise<void> | undefined

/**
 * Parse `env` output into a name→value map. Lines are NAME=VALUE (the first
 * `=` splits, values may contain `=`); lines that don't start a new entry are
 * newline continuations of the previous value — env values can legally
 * contain newlines.
 */
export function parseEnvOutput(stdout: string): Record<string, string> {
  const env: Record<string, string> = {}
  let current: string | undefined
  // The final newline is the last record's terminator, not part of its value.
  const body = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout
  for (const line of body.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(line)
    if (match) {
      current = match[1]
      env[current] = match[2]
    } else if (current !== undefined) {
      env[current] += `\n${line}`
    }
  }
  return env
}

/** Capture the env from a login shell once; resolves when cached (or failed). */
export function warmLoginPath(): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  if (!warmPromise) {
    warmPromise = new Promise((resolve) => {
      const shell = process.env.SHELL ?? '/bin/zsh'
      // Read PATH from `env` output rather than expanding "$PATH": fish
      // treats PATH as a list and would expand it space-joined, poisoning
      // every child environment it is merged into.
      execFile(
        shell,
        ['-l', '-c', 'command env'],
        { timeout: 5000, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (!err && stdout) {
            const env = parseEnvOutput(stdout)
            if (env.PATH?.trim()) loginPath = env.PATH.trim()
            loginEnv = env
          }
          resolve()
        }
      )
    })
  }
  return warmPromise
}

/** The captured login-shell PATH, or the current process PATH until then. */
export function getLoginPath(): string | undefined {
  return loginPath ?? process.env.PATH
}

/** A single login-shell env var, falling back to this process's environment. */
export function getLoginEnvVar(name: string): string | undefined {
  return loginEnv?.[name] ?? process.env[name]
}
