/**
 * Info about the bundled mastracode runtime and any globally installed CLI.
 * The runtime ships inside the app (asarUnpacked node_modules); these helpers
 * only report on it — the agent host is what actually imports it.
 */
import { spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** Version of the mastracode package bundled with the app, or null if missing. */
export function getMastracodeVersion(): string | null {
  const candidates = [
    // Packaged: vendored runtime the agent host actually imports.
    path.join(
      process.resourcesPath ?? '',
      'agent-runtime',
      'node_modules',
      'mastracode',
      'package.json'
    ),
    // Dev: app root node_modules (mastracode is a devDependency).
    path.join(app.getAppPath(), 'node_modules', 'mastracode', 'package.json')
  ]
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string }
      if (typeof pkg.version === 'string') return pkg.version
    } catch {
      // try next candidate
    }
  }
  return null
}

export interface CliDetectResult {
  found: boolean
  version?: string
}

/**
 * Best-effort version of a resolved CLI binary: follow symlinks (npm global
 * bins are symlinks into .../node_modules/mastracode), then walk up to the
 * package's own package.json.
 */
function readCliVersion(binPath: string): string | undefined {
  try {
    let dir = path.dirname(realpathSync(binPath))
    // Windows npm shims (.cmd) sit next to node_modules rather than inside it.
    const candidates = [path.join(dir, 'node_modules', 'mastracode', 'package.json')]
    for (let i = 0; i < 6 && path.dirname(dir) !== dir; i++) {
      candidates.push(path.join(dir, 'package.json'))
      dir = path.dirname(dir)
    }
    for (const p of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string }
        if (pkg.name === 'mastracode' && typeof pkg.version === 'string') return pkg.version
      } catch {
        // try next candidate
      }
    }
  } catch {
    // fall through
  }
  return undefined
}

/**
 * Check whether a global `mastracode` CLI is on PATH (best-effort, 5s cap).
 *
 * Locates the binary with `command -v` via the user's login+interactive
 * shell — GUI apps get a bare PATH, and homebrew (~/.zprofile) / nvm
 * (~/.zshrc) additions only apply there. The CLI has no --version flag
 * (and reads stdin when piped), so the version comes from its package.json.
 */
export function detectGlobalCli(): Promise<CliDetectResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: CliDetectResult): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    try {
      const child =
        process.platform === 'win32'
          ? spawn('where', ['mastracode'], { shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
          : spawn(process.env.SHELL ?? '/bin/zsh', ['-ilc', 'command -v mastracode'], {
              stdio: ['ignore', 'pipe', 'ignore']
            })
      let out = ''
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // ignore
        }
        finish({ found: false })
      }, 5000)
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      child.on('error', () => {
        clearTimeout(timer)
        finish({ found: false })
      })
      child.on('close', () => {
        clearTimeout(timer)
        // Shell rc files and interactive zsh can emit banners / escape
        // sequences around the real answer, so pick the path-looking line.
        const binPath = out
          .split('\n')
          .map((l) => l.trim())
          .find((l) =>
            process.platform === 'win32' ? /\\mastracode(\.\w+)?$/i.test(l) : l.startsWith('/')
          )
        if (binPath) finish({ found: true, version: readCliVersion(binPath) })
        else finish({ found: false })
      })
    } catch {
      finish({ found: false })
    }
  })
}
