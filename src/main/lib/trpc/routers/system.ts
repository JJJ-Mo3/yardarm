import os from 'node:os'
import { app } from 'electron'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { detectGlobalCli, getMastracodeVersion } from '../../system/mastracode-info'
import { ptyManager } from '../../terminal/pty-manager'
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
  })
})
