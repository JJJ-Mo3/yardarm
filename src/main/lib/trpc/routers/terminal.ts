/**
 * Terminal router: pty lifecycle (create, stream, write, resize, kill) plus the
 * Preview tab's dev-server helpers (dev command detection, start, URL detection).
 */
import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  chatIdFromTerminalId,
  devServerPort,
  devServersClash,
  urlPort,
  withChatPortEnv
} from '@shared/chat-port'
import { getDb, schema } from '../../db'
import { projectEnvRecord } from '../../db/project-settings'
import { detectDevCommand } from '../../terminal/dev-command'
import { buildMastracodeCommand, ptyManager } from '../../terminal/pty-manager'
import { extractLocalhostUrls } from '../../terminal/url-detect'
import { getMastracodeCliPath } from '../../system/mastracode-info'
import { publicProcedure, router } from '../trpc'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Human label for a Preview dev-server pty id (`dev-chat-<id>` / `dev-project-<id>`). */
function devServerLabel(id: string): string {
  const db = getDb()
  if (id.startsWith('dev-chat-')) {
    const chat = db
      .select()
      .from(schema.chats)
      .where(eq(schema.chats.id, id.slice('dev-chat-'.length)))
      .get()
    return chat ? `chat “${chat.title}”` : 'another chat'
  }
  if (id.startsWith('dev-project-')) {
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id.slice('dev-project-'.length)))
      .get()
    return project ? `project “${project.name}”` : 'another project'
  }
  return 'another chat'
}

/**
 * The chat a terminal belongs to: from its id for the per-chat terminals,
 * else the chat whose worktree is the terminal's cwd (extra sessions opened
 * in a chat's worktree). Null for project-root terminals.
 */
function terminalChatId(id: string, cwd?: string): string | null {
  const fromId = chatIdFromTerminalId(id)
  if (fromId || !cwd) return fromId
  const chat = getDb()
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(eq(schema.chats.worktreePath, cwd))
    .get()
  return chat?.id ?? null
}

/**
 * Env added to a spawned terminal: the project's env vars (Project Settings →
 * Environment) plus the chat's YARDARM_PORT / YARDARM_PORT_RANGE_END. User
 * values always win; PATH and YARDARM_BOOT are never set here.
 */
function terminalEnv(
  id: string,
  cwd: string,
  projectId: string | undefined
): Record<string, string> | undefined {
  const env = withChatPortEnv(projectId ? projectEnvRecord(projectId) : {}, terminalChatId(id, cwd))
  return Object.keys(env).length > 0 ? env : undefined
}

/** The port a Preview dev server with this pty id is asked to use (null = project default). */
function devPortFor(id: string, projectId: string | undefined): number | null {
  return devServerPort(chatIdFromTerminalId(id), projectId ? projectEnvRecord(projectId) : {})
}

/** Owning project of a Preview dev-server pty id, looked up from the DB. */
function devServerProjectId(id: string): string | undefined {
  if (id.startsWith('dev-project-')) return id.slice('dev-project-'.length)
  const chatId = chatIdFromTerminalId(id)
  if (!chatId) return undefined
  const chat = getDb()
    .select({ projectId: schema.chats.projectId })
    .from(schema.chats)
    .where(eq(schema.chats.id, chatId))
    .get()
  return chat?.projectId
}

/** Ports of the localhost URLs a running pty has printed so far. */
function seenPorts(id: string): number[] {
  const ports: number[] = []
  for (const url of extractLocalhostUrls(ptyManager.buffer(id))) {
    const port = urlPort(url)
    if (port !== null && !ports.includes(port)) ports.push(port)
  }
  return ports
}

/**
 * Other chats'/projects' Preview dev servers that would fight a server
 * started under `id` for a port (see devServersClash). Servers on their own
 * per-chat port are left out — they can run side by side.
 */
function clashingDevServers(id: string, projectId: string | undefined): string[] {
  const myPort = devPortFor(id, projectId)
  return ptyManager
    .ids()
    .filter((other) => other !== id)
    .filter((other) => other.startsWith('dev-chat-') || other.startsWith('dev-project-'))
    .filter((other) =>
      devServersClash(myPort, {
        port: devPortFor(other, devServerProjectId(other)),
        seenPorts: seenPorts(other)
      })
    )
}

export type TerminalStreamEvent = { type: 'data'; data: string } | { type: 'exit'; code: number }

export const terminalRouter = router({
  create: publicProcedure
    .input(
      z.object({
        id: z.string(),
        cwd: z.string(),
        cols: z.number().int().positive().default(80),
        rows: z.number().int().positive().default(24),
        kind: z.enum(['shell', 'mastracode']).default('shell'),
        /** Project whose env vars (Project Settings → Environment) to inject. */
        projectId: z.string().optional(),
        /**
         * Attach to an existing pty only — never spawn. Used for the
         * router-created command ptys (factory-*): if the command already
         * exited, creating here would register a stray interactive shell
         * under the command's id, making `exists` report it running forever.
         */
        attachOnly: z.boolean().default(false)
      })
    )
    .mutation(({ input }) => {
      if (input.attachOnly && !ptyManager.exists(input.id)) {
        // Attaching to retained output of an already-exited command still
        // counts: the stream subscription replays it plus the exit line.
        return { ok: true, attached: ptyManager.finishedOutput(input.id) !== null }
      }
      let command: string | undefined
      if (input.kind === 'mastracode') {
        // Interactive TUI in the given cwd. It resolves the same cwd-derived
        // resourceId as the chat's agent-host, so it sees the same threads,
        // and both sides run in unix-socket pubsub mode (the agent-host
        // passes unixSocketPubSub: true), so runs started in either process
        // stream live into the other.
        const cliPath = getMastracodeCliPath()
        if (!cliPath) throw new Error('Bundled mastracode runtime not found')
        command = buildMastracodeCommand(process.execPath, cliPath)
      }
      const env = terminalEnv(input.id, input.cwd, input.projectId)
      ptyManager.create(input.id, input.cwd, input.cols, input.rows, command, env)
      return { ok: true, attached: true }
    }),

  /**
   * Streams output; replays buffered scrollback first for reattach. For an
   * already-exited session with retained output, replays that output plus the
   * exit event (covers commands that finish before the terminal attaches).
   */
  stream: publicProcedure.input(z.object({ id: z.string() })).subscription(({ input }) => {
    return observable<TerminalStreamEvent>((emit) => {
      if (!ptyManager.exists(input.id)) {
        const done = ptyManager.finishedOutput(input.id)
        if (done) {
          emit.next({ type: 'data', data: done.buffer })
          emit.next({ type: 'exit', code: done.code })
        }
        return () => {}
      }
      const buffered = ptyManager.buffer(input.id)
      if (buffered) emit.next({ type: 'data', data: buffered })
      const offData = ptyManager.onData(input.id, (data) => emit.next({ type: 'data', data }))
      const offExit = ptyManager.onExit(input.id, (code) => emit.next({ type: 'exit', code }))
      return () => {
        offData()
        offExit()
      }
    })
  }),

  write: publicProcedure
    .input(z.object({ id: z.string(), data: z.string() }))
    .mutation(({ input }) => {
      ptyManager.write(input.id, input.data)
      return { ok: true }
    }),

  resize: publicProcedure
    .input(
      z.object({
        id: z.string(),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
      })
    )
    .mutation(({ input }) => {
      ptyManager.resize(input.id, input.cols, input.rows)
      return { ok: true }
    }),

  kill: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    ptyManager.kill(input.id)
    return { ok: true }
  }),

  exists: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    return ptyManager.exists(input.id)
  }),

  /** Whether the pty is live OR has retained output from a finished run. */
  hasOutput: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    return ptyManager.exists(input.id) || ptyManager.finishedOutput(input.id) !== null
  }),

  /**
   * The project's detected dev-server command, if any (Preview tab start
   * chip). With the dev-server pty `id`, the command carries that chat's port
   * where the tool takes one (see dev-command.ts).
   */
  devCommand: publicProcedure
    .input(
      z.object({ cwd: z.string(), id: z.string().optional(), projectId: z.string().optional() })
    )
    .query(({ input }) => {
      return detectDevCommand(input.cwd, input.id ? devPortFor(input.id, input.projectId) : null)
    }),

  /**
   * The port this Preview dev server is asked to use — the chat's own port
   * unless project env fixes PORT / YARDARM_PORT; null for project-level
   * servers. Preview prefers detected URLs on it.
   */
  devPort: publicProcedure
    .input(z.object({ id: z.string(), projectId: z.string().optional() }))
    .query(({ input }) => ({ port: devPortFor(input.id, input.projectId) })),

  /**
   * Starts the detected dev command in a dedicated pty (Preview tab). The
   * command is re-detected here rather than accepted from the renderer; the
   * pty ends when the command exits, so `exists` doubles as running-state.
   * The chat's port reaches the server as PORT (unless project env sets PORT)
   * and, for tools that need it, on the command line. `stopIds` are killed
   * first, with a short grace period for the port to free — but only those
   * that really clash with this server's port; dev servers on their own
   * per-chat port keep running.
   */
  startDevServer: publicProcedure
    .input(
      z.object({
        id: z.string(),
        cwd: z.string(),
        stopIds: z.array(z.string()).default([]),
        /** Project whose env vars (Project Settings → Environment) to inject. */
        projectId: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      const port = devPortFor(input.id, input.projectId)
      const dev = detectDevCommand(input.cwd, port)
      if (!dev) throw new Error('No dev/serve/start script or root .html files in this project')
      const clashing = clashingDevServers(input.id, input.projectId)
      const stopped = input.stopIds.filter((id) => clashing.includes(id) && ptyManager.exists(id))
      for (const id of stopped) ptyManager.kill(id)
      if (stopped.length > 0) await sleep(1000)
      const env: Record<string, string> = terminalEnv(input.id, input.cwd, input.projectId) ?? {}
      // PORT is what most Node dev servers read; a PORT from project env wins.
      if (port !== null && !('PORT' in env)) env.PORT = String(port)
      ptyManager.create(input.id, input.cwd, 80, 24, dev.command, env)
      return { ok: true, port }
    }),

  /**
   * Preview dev servers running for *other* chats/projects that would clash
   * with one started under `excludeId` — same port, no per-chat port on
   * either side, or a server that visibly ignored its assigned port. The
   * Preview tab offers to stop these when starting its own server; servers
   * on a different per-chat port are not listed and keep running.
   */
  otherDevServers: publicProcedure
    .input(z.object({ excludeId: z.string(), projectId: z.string().optional() }))
    .query(({ input }) => {
      return clashingDevServers(input.excludeId, input.projectId).map((id) => ({
        id,
        label: devServerLabel(id)
      }))
    }),

  /** Localhost dev-server URLs seen in the given terminals' scrollback (Preview tab). */
  detectUrls: publicProcedure
    .input(z.object({ ids: z.array(z.string()).max(8) }))
    .query(({ input }) => {
      const urls: string[] = []
      for (const id of input.ids) {
        for (const url of extractLocalhostUrls(ptyManager.buffer(id))) {
          if (!urls.includes(url)) urls.push(url)
        }
      }
      return urls
    })
})
