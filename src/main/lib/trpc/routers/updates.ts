/**
 * tRPC surface for the in-app updater (src/main/lib/updates). The renderer
 * polls `status` and drives check/install/restart; `setAutoUpdate` persists
 * the "Automatically update" preference.
 */
import { app, shell } from 'electron'
import { z } from 'zod'
import { updateManager } from '../../updates/update-manager'
import { publicProcedure, router } from '../trpc'

export const updatesRouter = router({
  status: publicProcedure.query(() => updateManager.getStatus()),

  check: publicProcedure.mutation(() => updateManager.check()),

  // Fire-and-forget: resolves immediately with phase 'downloading' so the
  // renderer's status polling drives progress; errors surface via status.
  install: publicProcedure.mutation(() => {
    void updateManager.downloadAndInstall()
    return updateManager.getStatus()
  }),

  openRelease: publicProcedure.mutation(async () => {
    const url =
      updateManager.getStatus().releaseUrl ?? 'https://github.com/JJJ-Mo3/yardarm/releases'
    await shell.openExternal(url)
    return { ok: true }
  }),

  restart: publicProcedure.mutation(() => {
    // Deferred a beat so the mutation response reaches the renderer first.
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 150)
    return { ok: true }
  }),

  setAutoUpdate: publicProcedure.input(z.object({ enabled: z.boolean() })).mutation(({ input }) => {
    updateManager.setAutoUpdate(input.enabled)
    return { ok: true }
  })
})
