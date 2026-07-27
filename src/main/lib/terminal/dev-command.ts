/**
 * Detects the command that starts a project's dev server, for the Preview
 * tab's one-click "start dev server" chip: package.json scripts pick the
 * script, the lockfile picks the package manager, and plain static sites
 * (root .html files, no dev script) fall back to a loopback-only python
 * http.server. The pure pieces are exported separately from the fs wrapper
 * so they can be unit-tested.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface DevCommand {
  /** Full shell command, e.g. `pnpm run dev`. */
  command: string
  /** The package.json script it runs, e.g. `dev`, or `static` for the fallback. */
  script: string
  /** Short human-friendly name for buttons/chips; the full command goes in tooltips. */
  label: string
}

/** Most dev-server-like first; `start` last (often a prod server, still a server). */
const SCRIPT_PREFERENCE = ['dev', 'serve', 'start']

const LOCKFILE_TO_PM: Array<[string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm']
]

export function packageManagerFromLockfiles(lockfiles: string[]): string {
  for (const [file, pm] of LOCKFILE_TO_PM) {
    if (lockfiles.includes(file)) return pm
  }
  return 'npm'
}

export function pickDevCommand(
  scripts: Record<string, unknown>,
  packageManager: string
): DevCommand | null {
  for (const script of SCRIPT_PREFERENCE) {
    if (typeof scripts[script] === 'string') {
      // `<pm> run <script>` is valid for npm, pnpm, yarn, and bun alike.
      return { command: `${packageManager} run ${script}`, script, label: 'dev server' }
    }
  }
  return null
}

/** Static-site fallback port; uncommon enough to rarely collide with real dev servers. */
export const STATIC_SERVER_PORT = 4173

/** A loopback-only static file server for projects that are just .html files. */
export function pickStaticCommand(entries: string[]): DevCommand | null {
  if (!entries.some((e) => e.toLowerCase().endsWith('.html'))) return null
  return {
    // python3 ships with the macOS command-line tools (a git prerequisite).
    command: `python3 -m http.server ${STATIC_SERVER_PORT} --bind 127.0.0.1`,
    script: 'static',
    label: 'static file server'
  }
}

/**
 * Reads the project at cwd: a package.json dev-like script wins, then the
 * static-site fallback when the root has .html files; null when neither.
 */
export function detectDevCommand(cwd: string): DevCommand | null {
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    if (pkg.scripts) {
      const lockfiles = LOCKFILE_TO_PM.map(([file]) => file).filter((file) =>
        fs.existsSync(path.join(cwd, file))
      )
      const fromScripts = pickDevCommand(pkg.scripts, packageManagerFromLockfiles(lockfiles))
      if (fromScripts) return fromScripts
    }
  } catch {}
  try {
    return pickStaticCommand(fs.readdirSync(cwd))
  } catch {
    return null
  }
}
