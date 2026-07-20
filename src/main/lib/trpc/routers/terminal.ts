import { observable } from '@trpc/server/observable'
import { z } from 'zod'
import { ptyManager } from '../../terminal/pty-manager'
import { publicProcedure, router } from '../trpc'

export type TerminalStreamEvent = { type: 'data'; data: string } | { type: 'exit'; code: number }

export const terminalRouter = router({
  create: publicProcedure
    .input(
      z.object({
        id: z.string(),
        cwd: z.string(),
        cols: z.number().int().positive().default(80),
        rows: z.number().int().positive().default(24)
      })
    )
    .mutation(({ input }) => {
      ptyManager.create(input.id, input.cwd, input.cols, input.rows)
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
  })
})
