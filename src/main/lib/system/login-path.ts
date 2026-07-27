/**
 * Login-shell PATH capture. Packaged GUI apps launch with the bare launchd
 * PATH (/usr/bin:/bin:...), so anything the user installed via homebrew, nvm,
 * etc. is invisible to processes we spawn — notably the LSP language servers
 * behind the IDE problems panel. The user's real PATH only exists in login
 * shells (~/.zprofile, path_helper), so it's captured once from one and
 * merged into child-process environments.
 */
import { execFile } from 'node:child_process'

let loginPath: string | undefined
let warmPromise: Promise<void> | undefined

/** Capture $PATH from a login shell once; resolves when cached (or failed). */
export function warmLoginPath(): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  if (!warmPromise) {
    warmPromise = new Promise((resolve) => {
      const shell = process.env.SHELL ?? '/bin/zsh'
      execFile(shell, ['-l', '-c', 'printf %s "$PATH"'], { timeout: 5000 }, (err, stdout) => {
        const captured = stdout?.trim()
        if (!err && captured) loginPath = captured
        resolve()
      })
    })
  }
  return warmPromise
}

/** The captured login-shell PATH, or the current process PATH until then. */
export function getLoginPath(): string | undefined {
  return loginPath ?? process.env.PATH
}
