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
  openExternal: publicProcedure.input(z.object({ url: z.string() })).mutation(({ input }) => {
    if (!/^https?:\/\//i.test(input.url)) throw new Error('Only http(s) URLs can be opened')
    void shell.openExternal(input.url)
    return { ok: true }
  }),

  /** Toggles detached DevTools for a Preview webview (the webview-tag method is unreliable). */
  previewDevTools: publicProcedure
    .input(z.object({ webContentsId: z.number().int() }))
    .mutation(({ input }) => {
      if (!isPreviewGuest(input.webContentsId)) throw new Error('Not a preview webview')
      const wc = webContents.fromId(input.webContentsId)
      if (!wc || wc.isDestroyed()) throw new Error('Preview page is gone')
      if (wc.isDevToolsOpened()) wc.closeDevTools()
      else wc.openDevTools({ mode: 'detach' })
      return { ok: true }
    })
})
