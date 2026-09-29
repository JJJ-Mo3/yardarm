/**
 * Docker runtime health probes for the Factory tab's local database card.
 *
 * `npm run db:up` needs three things that fail in distinct, confusing ways
 * when absent: the docker CLI on PATH, a running daemon, and the compose
 * plugin. probeDockerStatus checks each so the UI can show targeted guidance
 * instead of a cryptic pty failure. On macOS it also detects a startable
 * runtime (Docker Desktop / OrbStack / colima) so the card can offer a
 * one-click start. probeTcp backs the pre-start DATABASE_URL reachability
 * warning in the Server section.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import { findExecutable } from '../../agent-host/lsp-diagnostics'
import { getLoginPath } from '../system/login-path'

export type DockerRuntimeId = 'docker-desktop' | 'orbstack' | 'colima'

export interface DockerRuntimeStatus {
  dockerPath: string | null
  daemonRunning: boolean
  composeAvailable: boolean
  /** Startable runtime detected on this machine (macOS only), if any. */
  runtime: { id: DockerRuntimeId; label: string } | null
}

const DOCKER_DIRS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/Applications/Docker.app/Contents/Resources/bin'
]

/** True when the command exits 0 within the timeout. */
function probeCommand(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 5000, env: { ...process.env, PATH: getLoginPath() } }, (err) =>
      resolve(!err)
    )
  })
}

async function pathExists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

async function detectRuntime(): Promise<DockerRuntimeStatus['runtime']> {
  if (process.platform !== 'darwin') return null
  if (await pathExists('/Applications/Docker.app')) {
    return { id: 'docker-desktop', label: 'Docker Desktop' }
  }
  if (await pathExists('/Applications/OrbStack.app')) return { id: 'orbstack', label: 'OrbStack' }
  if (findExecutable('colima', getLoginPath(), ['/usr/local/bin', '/opt/homebrew/bin'])) {
    return { id: 'colima', label: 'colima' }
  }
  return null
}

export async function probeDockerStatus(): Promise<DockerRuntimeStatus> {
  const dockerPath = findExecutable('docker', getLoginPath(), DOCKER_DIRS)
  if (!dockerPath) {
    return {
      dockerPath: null,
      daemonRunning: false,
      composeAvailable: false,
      runtime: await detectRuntime()
    }
  }
  const [daemonRunning, composeAvailable, runtime] = await Promise.all([
    probeCommand(dockerPath, ['info', '--format', '{{.ServerVersion}}']),
    probeCommand(dockerPath, ['compose', 'version', '--short']),
    detectRuntime()
  ])
  return { dockerPath, daemonRunning, composeAvailable, runtime }
}

/**
 * Shell command that brings the runtime's daemon up. Run in the visible
 * database pty so the user sees progress (colima start takes ~30s).
 */
export function runtimeStartCommand(id: DockerRuntimeId): string {
  switch (id) {
    case 'docker-desktop':
      return 'open -a Docker'
    case 'orbstack':
      return 'open -a OrbStack'
    case 'colima':
      return 'colima start'
  }
}

/** True when a TCP connection to host:port succeeds within the timeout. */
export function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port })
    const done = (ok: boolean): void => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}
