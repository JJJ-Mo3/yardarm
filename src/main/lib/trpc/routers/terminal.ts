import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
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

export type TerminalStreamEvent = { type: 'data'; data: string } | { type: 'exit'; code: number }

export const terminalRouter = router({
  create: publicProcedure
    .input(
      z.object({
        id: z.string(),
        cwd: z.string(),
        cols: z.number().int().positive().default(80),
        rows: z.number().int().positive().default(24),
        kind: z.enum(['shell', 'mastracode']).default('shell')
      })
    )
    .mutation(({ input }) => {
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
      ptyManager.create(input.id, input.cwd, input.cols, input.rows, command)
      return { ok: true }
    }),

  /** Streams output; replays buffered scrollback first for reattach. */
  stream: publicProcedure.input(z.object({ id: z.string() })).subscription(({ input }) => {
    return observable<TerminalStreamEvent>((emit) => {
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

  /** The project's detected dev-server command, if any (Preview tab start chip). */
  devCommand: publicProcedure.input(z.object({ cwd: z.string() })).query(({ input }) => {
    return detectDevCommand(input.cwd)
  }),

  /**
   * Starts the detected dev command in a dedicated pty (Preview tab). The
   * command is re-detected here rather than accepted from the renderer; the
   * pty ends when the command exits, so `exists` doubles as running-state.
   * `stopIds` (other chats' Preview dev servers — they'd fight over the same
   * port) are killed first, with a short grace period for the port to free.
   */
  startDevServer: publicProcedure
    .input(z.object({ id: z.string(), cwd: z.string(), stopIds: z.array(z.string()).default([]) }))
    .mutation(async ({ input }) => {
      const dev = detectDevCommand(input.cwd)
      if (!dev) throw new Error('No dev/serve/start script or root .html files in this project')
      const stopped = input.stopIds.filter(
        (id) =>
          id !== input.id &&
          (id.startsWith('dev-chat-') || id.startsWith('dev-project-')) &&
          ptyManager.exists(id)
      )
      for (const id of stopped) ptyManager.kill(id)
      if (stopped.length > 0) await sleep(1000)
      ptyManager.create(input.id, input.cwd, 80, 24, dev.command)
      return { ok: true }
    }),

  /**
   * Preview dev servers currently running for *other* chats/projects. Ports
   * clash across worktrees, so the Preview tab offers to stop these when
   * starting its own server.
   */
  otherDevServers: publicProcedure.input(z.object({ excludeId: z.string() })).query(({ input }) => {
    return ptyManager
      .ids()
      .filter(
        (id) =>
          id !== input.excludeId && (id.startsWith('dev-chat-') || id.startsWith('dev-project-'))
      )
      .map((id) => ({ id, label: devServerLabel(id) }))
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
