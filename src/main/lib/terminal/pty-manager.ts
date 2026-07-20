/**
 * node-pty session manager. Terminals are keyed by id, scoped to a cwd
 * (usually a chat worktree), and stream data to subscribers.
 */
import { EventEmitter } from 'node:events'
import os from 'node:os'
import * as pty from 'node-pty'

interface PtySession {
  id: string
  proc: pty.IPty
  cwd: string
  /** Rolling buffer replayed to late subscribers (e.g. after tab switch). */
  buffer: string
  emitter: EventEmitter
}

const MAX_BUFFER = 200_000

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/zsh'
}

export class PtyManager {
  private sessions = new Map<string, PtySession>()

  create(id: string, cwd: string, cols = 80, rows = 24): void {
    if (this.sessions.has(id)) return
    // Login shell: GUI apps get a bare PATH on macOS, and homebrew / node
    // version managers only add themselves in login shells (~/.zprofile,
    // /etc/zprofile path_helper) — without -l, npm/node are often missing.
    const shellArgs = process.platform === 'win32' ? [] : ['-l']
    const proc = pty.spawn(defaultShell(), shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM_PROGRAM: 'yardarm' } as Record<string, string>
    })
    const session: PtySession = { id, proc, cwd, buffer: '', emitter: new EventEmitter() }
    session.emitter.setMaxListeners(20)
    proc.onData((data) => {
      session.buffer = (session.buffer + data).slice(-MAX_BUFFER)
      session.emitter.emit('data', data)
    })
    proc.onExit(({ exitCode }) => {
      session.emitter.emit('exit', exitCode)
      this.sessions.delete(id)
    })
    this.sessions.set(id, session)
  }

  exists(id: string): boolean {
    return this.sessions.has(id)
  }

  buffer(id: string): string {
    return this.sessions.get(id)?.buffer ?? ''
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.proc.resize(cols, rows)
    } catch {
      // ignore resize races on exit
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.proc.kill()
    } catch {
      // already dead
    }
    this.sessions.delete(id)
  }

  onData(id: string, listener: (data: string) => void): () => void {
    const s = this.sessions.get(id)
    if (!s) return () => {}
    s.emitter.on('data', listener)
    return () => s.emitter.off('data', listener)
  }

  onExit(id: string, listener: (code: number) => void): () => void {
    const s = this.sessions.get(id)
    if (!s) return () => {}
    s.emitter.on('exit', listener)
    return () => s.emitter.off('exit', listener)
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  /** Kill sessions whose cwd is under the given directory (worktree cleanup). */
  killByCwdPrefix(prefix: string): void {
    for (const [id, s] of this.sessions) {
      if (s.cwd.startsWith(prefix)) this.kill(id)
    }
  }
}

export const ptyManager = new PtyManager()
export const homeDir = os.homedir()
