import os from 'node:os'
import { app, shell, webContents } from 'electron'
import { z } from 'zod'
import { agentSessionManager } from '../../agent/agent-session-manager'
import {
  detectGlobalCli,
  fetchMastracodeLatest,
  getMastracodeVersion
} from '../../system/mastracode-info'
import { ptyManager } from '../../terminal/pty-manager'
import { isPreviewGuest } from '../../../windows/preview-guests'
import { publicProcedure, router } from '../trpc'

/** Terminal id used for the one-click global CLI install. */
export const CLI_INSTALL_TERMINAL_ID = '__cli-install__'

export const systemRouter = router({
  /** Boots the utility agent host to prove the bundled runtime works. */
  preflight: publicProcedure.query(async () => {
    const result = await agentSessionManager.preflight()
    return {
      ok: result.ok,
      error: result.error,
      mastracodeVersion: getMastracodeVersion(),
      nodeVersion: process.versions.node,
      appVersion: app.getVersion()
    }
  }),

  detectCli: publicProcedure.query(() => detectGlobalCli()),

  /** Latest mastracode on npm vs the bundled runtime (offline-safe nulls). */
  mastracodeLatest: publicProcedure.query(() => fetchMastracodeLatest()),

  /** Runs `npm install -g mastracode` in a pty; output streams via terminal.stream. */
  installCli: publicProcedure.mutation(() => {
    const id = CLI_INSTALL_TERMINAL_ID
    ptyManager.kill(id)
    ptyManager.create(id, os.homedir())
    // Wait for the shell to draw its prompt before typing — writing during
    // zsh startup races the line editor and garbles the echoed command.
    // `exit` ends the shell so subscribers get a terminal exit event.
    let sent = false
    const send = (): void => {
      if (sent) return
      sent = true
      offData()
      clearTimeout(fallback)
      ptyManager.write(
        id,
        'npm install -g mastracode && echo "[yardarm] CLI install complete"; exit\r'
      )
    }
    const offData = ptyManager.onData(id, () => {
      offData()
      setTimeout(send, 250)
    })
    const fallback = setTimeout(send, 2000)
    return { terminalId: id }
  }),

  /** Opens an http(s) URL in the system browser (renderer window.open is unreliable when sandboxed). */
  openExternal: publicProcedure.input(z.object({ url: z.string() })).mutation(async ({ input }) => {
    if (!/^https?:\/\//i.test(input.url)) throw new Error('Only http(s) URLs can be opened')
    // Awaited so a launch failure surfaces in the renderer instead of vanishing.
    await shell.openExternal(input.url, { activate: true })
    return { ok: true }
  }),

  /**
   * Docks DevTools for a Preview webview into the renderer's side-pane
   * <webview> via setDevToolsWebContents (with it, 'detach' renders into the
   * supplied webContents instead of a new window). Without a devtools id it
   * closes them. Main-process because the webview-tag method is unreliable.
   */
  previewDevTools: publicProcedure
    .input(
      z.object({
        pageWebContentsId: z.number().int(),
        devtoolsWebContentsId: z.number().int().optional()
      })
    )
    .mutation(({ input }) => {
      if (!isPreviewGuest(input.pageWebContentsId)) throw new Error('Not a preview webview')
      const page = webContents.fromId(input.pageWebContentsId)
      if (!page || page.isDestroyed()) throw new Error('Preview page is gone')
      if (input.devtoolsWebContentsId === undefined) {
        page.closeDevTools()
        return { ok: true }
      }
      // The pane host must also be one of our own webviews — never the app window.
      if (!isPreviewGuest(input.devtoolsWebContentsId)) throw new Error('Not a preview webview')
      const host = webContents.fromId(input.devtoolsWebContentsId)
      if (!host || host.isDestroyed()) throw new Error('DevTools pane is gone')
      page.setDevToolsWebContents(host)
      page.openDevTools({ mode: 'detach' })
      return { ok: true }
    })
})
