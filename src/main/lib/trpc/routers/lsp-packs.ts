/**
 * tRPC router for optional language-server packs (Settings → Languages and
 * the IDE problems-panel download offer). Download jobs are fire-and-forget;
 * the renderer polls `list` for phase/progress.
 */
import { z } from 'zod'
import { getLspPackManager } from '../../lsp-packs/pack-manager'
import { publicProcedure, router } from '../trpc'

const packIdInput = z.object({ packId: z.enum(['web', 'yaml', 'python', 'erb']) })

export const lspPacksRouter = router({
  list: publicProcedure.query(async () => (await getLspPackManager()).list()),

  download: publicProcedure.input(packIdInput).mutation(async ({ input }) => {
    ;(await getLspPackManager()).startDownload(input.packId)
  }),

  cancel: publicProcedure.input(packIdInput).mutation(async ({ input }) => {
    ;(await getLspPackManager()).cancel(input.packId)
  }),

  remove: publicProcedure.input(packIdInput).mutation(async ({ input }) => {
    await (await getLspPackManager()).remove(input.packId)
  })
})
