/**
 * Detects the command that starts a project's dev server, for the Preview
 * tab's one-click "start dev server" chip: package.json scripts pick the
 * script, the lockfile picks the package manager. The pure pieces are
 * exported separately from the fs wrapper so they can be unit-tested.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface DevCommand {
  /** Full shell command, e.g. `pnpm run dev`. */
  command: string
  /** The package.json script it runs, e.g. `dev`. */
  script: string
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
      return { command: `${packageManager} run ${script}`, script }
    }
  }
  return null
}

/** Reads the project at cwd; null when there is no package.json or no dev-like script. */
export function detectDevCommand(cwd: string): DevCommand | null {
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    if (!pkg.scripts) return null
    const lockfiles = LOCKFILE_TO_PM.map(([file]) => file).filter((file) =>
      fs.existsSync(path.join(cwd, file))
    )
    return pickDevCommand(pkg.scripts, packageManagerFromLockfiles(lockfiles))
  } catch {
    return null
  }
}
