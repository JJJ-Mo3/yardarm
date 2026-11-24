/**
 * Detects the command that starts a project's dev server, for the Preview
 * tab's one-click "start dev server" chip: package.json scripts pick the
 * script, the lockfile picks the package manager, and plain static sites
 * (root .html files, no dev script) fall back to a loopback-only python
 * http.server. When the chat has a port (see @shared/chat-port) it is passed
 * the way the tool expects where that is safely knowable: a `--port` flag
 * for tools that ignore the PORT variable (Vite, Astro, Angular, webpack
 * dev server), the port argument of the static server, and otherwise just
 * the PORT environment variable (set by the caller), which most Node dev
 * servers honor. The pure pieces are exported separately from the fs wrapper
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
  /** Port the server was asked to use, when one was requested. */
  port?: number
  /**
   * How the port reaches the server: `flag` (--port appended), `arg` (static
   * server argument) or `env` (PORT variable only — the project may ignore it).
   */
  portVia?: 'flag' | 'arg' | 'env'
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

function validPort(port: number | null | undefined): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * True when the script body is a plain invocation of a dev server known to
 * take `--port <n>` and to ignore the PORT variable, so appending the flag is
 * safe. Anything compound (`&&`, pipes, env prefixes, variables) or already
 * choosing a port is left alone.
 */
export function scriptTakesPortFlag(scriptBody: string): boolean {
  const body = scriptBody.trim()
  if (body.length === 0 || /[;&|<>$`'"\\\n(){}=]/.test(body)) return false
  const tokens = body.split(/\s+/)
  if (tokens.some((t) => t === '-p' || t === '--port' || t.startsWith('--port='))) return false
  const [tool, sub] = tokens
  if (tool === 'vite') {
    return sub === undefined || sub.startsWith('-') || sub === 'dev' || sub === 'serve'
  }
  if (tool === 'astro') return sub === 'dev'
  if (tool === 'ng') return sub === 'serve'
  if (tool === 'webpack') return sub === 'serve'
  return tool === 'webpack-dev-server'
}

export function pickDevCommand(
  scripts: Record<string, unknown>,
  packageManager: string,
  port?: number | null
): DevCommand | null {
  for (const script of SCRIPT_PREFERENCE) {
    const body = scripts[script]
    if (typeof body === 'string') {
      // `<pm> run <script>` is valid for npm, pnpm, yarn, and bun alike.
      const command = `${packageManager} run ${script}`
      if (!validPort(port)) return { command, script, label: 'dev server' }
      if (scriptTakesPortFlag(body)) {
        // npm needs `--` to forward arguments to the script; pnpm, yarn and
        // bun forward them as-is (and pnpm would pass a literal `--` through).
        const forwarded = packageManager === 'npm' ? `-- --port ${port}` : `--port ${port}`
        return {
          command: `${command} ${forwarded}`,
          script,
          label: 'dev server',
          port,
          portVia: 'flag'
        }
      }
      return { command, script, label: 'dev server', port, portVia: 'env' }
    }
  }
  return null
}

/** Static-site fallback port; uncommon enough to rarely collide with real dev servers. */
export const STATIC_SERVER_PORT = 4173

/** A loopback-only static file server for projects that are just .html files. */
export function pickStaticCommand(entries: string[], port?: number | null): DevCommand | null {
  if (!entries.some((e) => e.toLowerCase().endsWith('.html'))) return null
  const usePort = validPort(port) ? port : STATIC_SERVER_PORT
  return {
    // python3 ships with the macOS command-line tools (a git prerequisite).
    command: `python3 -m http.server ${usePort} --bind 127.0.0.1`,
    script: 'static',
    label: 'static file server',
    ...(validPort(port) ? { port, portVia: 'arg' as const } : {})
  }
}

/**
 * Reads the project at cwd: a package.json dev-like script wins, then the
 * static-site fallback when the root has .html files; null when neither.
 * `port` (the chat's port) is applied as described in the file header.
 */
export function detectDevCommand(cwd: string, port?: number | null): DevCommand | null {
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    if (pkg.scripts) {
      const lockfiles = LOCKFILE_TO_PM.map(([file]) => file).filter((file) =>
        fs.existsSync(path.join(cwd, file))
      )
      const fromScripts = pickDevCommand(pkg.scripts, packageManagerFromLockfiles(lockfiles), port)
      if (fromScripts) return fromScripts
    }
  } catch {}
  try {
    return pickStaticCommand(fs.readdirSync(cwd), port)
  } catch {
    return null
  }
}
