/**
 * Port reclaim for the Factory dev server's orphan-grandchild failure mode.
 *
 * `npm run dev` runs `mastra factory dev`, which spawns the real server as a
 * grandchild (npm → sh → mastra CLI → node .mastra/output/index.mjs). Killing
 * the pty only signals the login shell, so the server can survive holding its
 * port with a stale environment — every "restart" then fronts the old server
 * (EADDRINUSE or a silently different port) and .env fixes never take effect.
 *
 * reclaimPort waits for the port to be released naturally, then escalates to
 * killing listeners — but ONLY processes that look like something we started
 * (node/npm/mastra); anything else produces a descriptive error instead of a
 * kill. Reclaim always completes before a new pty is created, so it can never
 * race a freshly started server. Electron-free; pure helpers are unit-tested.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { probeTcp } from './docker-status'
import { portFromEnv } from './factory-api'
import { readEnvLines } from './factory-dir'

const execFileAsync = promisify(execFile)

const POLL_INTERVAL_MS = 250

/** Parse `lsof -ti` output (one pid per line) into pids, skipping garbage. */
export function parseLsofPids(stdout: string): number[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map((line) => Number.parseInt(line, 10))
}

/**
 * Is this listener something the Factory pty plausibly started (and that we
 * may therefore kill)? Word-boundary matches for node / npm / mastra and the
 * built server entry; rejects everything else (postgres, python, docker, …).
 */
export function isReclaimableCommand(command: string): boolean {
  return /(^|[\s/])(node|npm|npx|mastra)([\s/]|$)|\.mastra\/output|node_modules\/\.bin/i.test(
    command
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * True once nothing accepts TCP connections on `port` (checks IPv4 and IPv6
 * loopback) within `timeoutMs`; false if it is still held at the deadline.
 */
export async function waitForPortRelease(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const [v4, v6] = await Promise.all([
      probeTcp('127.0.0.1', port, 300),
      probeTcp('::1', port, 300)
    ])
    if (!v4 && !v6) return true
    if (Date.now() >= deadline) return false
    await sleep(POLL_INTERVAL_MS)
  }
}

/** Port the checkout's .env designates right now. */
export async function factoryPortFromDir(dir: string): Promise<number> {
  const { lines } = await readEnvLines(dir)
  return portFromEnv(lines)
}

/** Listener pids on `port` via lsof (exit 1 with no output = none). */
async function listListenerPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      timeout: 5000
    })
    return parseLsofPids(stdout)
  } catch (err) {
    // lsof exits 1 when nothing matches; stdout may still carry partial pids.
    const stdout = (err as { stdout?: string }).stdout
    return typeof stdout === 'string' ? parseLsofPids(stdout) : []
  }
}

/** pid → full command line for the given pids (missing pids are omitted). */
async function commandsForPids(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (pids.length === 0) return out
  try {
    const { stdout } = await execFileAsync('ps', ['-p', pids.join(','), '-o', 'pid=,command='], {
      timeout: 5000
    })
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/)
      if (m) out.set(Number.parseInt(m[1], 10), m[2].trim())
    }
  } catch {}
  return out
}

export interface ReclaimResult {
  port: number
  /** Something was listening on the port when reclaim began. */
  wasHeld: boolean
  /** Pids we had to signal (empty when the port freed on its own). */
  killedPids: number[]
}

export interface ReclaimOptions {
  /** How long to wait for a natural release before escalating. */
  graceMs?: number
  /** Wait after SIGTERM before escalating to SIGKILL. */
  termWaitMs?: number
  /** Wait after SIGKILL before giving up. */
  killWaitMs?: number
}

/**
 * Ensure `port` is free: wait for a natural release, then kill reclaimable
 * listeners (SIGTERM → SIGKILL, re-checking once for re-parented survivors).
 * Throws a descriptive Error when the port is held by a process we did not
 * start, or when it cannot be freed.
 */
export async function reclaimPort(port: number, opts?: ReclaimOptions): Promise<ReclaimResult> {
  const graceMs = opts?.graceMs ?? 5000
  const termWaitMs = opts?.termWaitMs ?? 3000
  const killWaitMs = opts?.killWaitMs ?? 2000

  const heldAtStart = !(await waitForPortRelease(port, 0))
  if (!heldAtStart) return { port, wasHeld: false, killedPids: [] }
  if (await waitForPortRelease(port, graceMs)) return { port, wasHeld: true, killedPids: [] }

  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(`Port ${port} is still in use — stop the process holding it and retry`)
  }

  const killed: number[] = []
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    const pids = await listListenerPids(port)
    if (pids.length === 0) {
      // lsof missed it (or it just exited) — trust one final probe.
      if (await waitForPortRelease(port, 1000)) return { port, wasHeld: true, killedPids: killed }
      throw new Error(`Port ${port} is still in use — stop the process holding it and retry`)
    }
    const commands = await commandsForPids(pids)
    for (const pid of pids) {
      const command = commands.get(pid) ?? ''
      if (command && !isReclaimableCommand(command)) {
        throw new Error(
          `Port ${port} is in use by another process (pid ${pid}: ${command}) — stop it or change PORT in .env`
        )
      }
      try {
        process.kill(pid, signal)
        killed.push(pid)
      } catch {}
    }
    const waitMs = signal === 'SIGTERM' ? termWaitMs : killWaitMs
    if (await waitForPortRelease(port, waitMs)) {
      return { port, wasHeld: true, killedPids: [...new Set(killed)] }
    }
  }

  const survivors = await listListenerPids(port)
  const commands = await commandsForPids(survivors)
  const detail = survivors
    .map((pid) => `pid ${pid}${commands.get(pid) ? `: ${commands.get(pid)}` : ''}`)
    .join(', ')
  throw new Error(`Could not free port ${port}${detail ? ` (${detail})` : ''} — stop it manually`)
}
