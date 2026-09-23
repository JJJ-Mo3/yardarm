import { app, BrowserWindow, dialog } from 'electron'
import { createIPCHandler } from 'trpc-electron/main'
import { initDb, closeDb, maintainDb } from './lib/db'
import { appRouter } from './lib/trpc/routers'
import { agentSessionManager } from './lib/agent/agent-session-manager'
import { normalizeModelIdsInSettings } from './lib/mastra-config/normalize-model-ids'
import { seedLspEnabled } from './lib/mastra-config/settings-json'
import { ptyManager } from './lib/terminal/pty-manager'
import { createWindow, setIpcHandler } from './windows/window-manager'
import { updateManager } from './lib/updates/update-manager'
import { getLspPackManager } from './lib/lsp-packs/pack-manager'
import { warmLoginPath } from './lib/system/login-path'
import icon from '../../build/icon.png?asset'

// Long chat transcripts and Monaco buffers can outgrow the default renderer
// heap; raise the V8 old-space ceiling (must be set before app ready).
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192')

// Two OS-level instances would contend over the same SQLite database and
// mastracode thread locks; a second launch focuses the existing instance
// instead (multiple windows are available in-app).
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  } else {
    createWindow()
  }
})

app.whenReady().then(() => {
  app.setAppUserModelId('dev.yardarm.app')

  // Packaged macOS builds get the icon from the .icns; in dev the dock
  // would otherwise show the stock Electron icon.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(icon)
  }

  initDb()
  maintainDb()
  setInterval(maintainDb, 30 * 60 * 1000).unref()

  const handler = createIPCHandler({ router: appRouter, windows: [] })
  setIpcHandler(handler)

  createWindow()
  updateManager.init()
  void getLspPackManager().then((m) => m.cleanupPartial())

  // Capture the login-shell PATH (packaged apps launch with the bare launchd
  // one), heal gateway-prefixed model ids saved before catalog normalization,
  // seed the (0.36+ opt-in) LSP tools flag, then warm up + verify the bundled
  // mastracode runtime (hosts read settings.json at boot and inherit the
  // captured PATH, so these run before the first host spawns); renderer
  // preflight queries reuse the booted host.
  warmLoginPath()
    .then(() => normalizeModelIdsInSettings())
    .catch(() => {})
    .then(() => seedLspEnabled())
    .catch(() => {})
    .then(() => agentSessionManager.preflight())
    .then((res) => {
      if (!res.ok) console.error('[preflight] mastracode boot failed:', res.error)
      // First catalog fetch corrects the cached provider env-var names and
      // pushes env-var-referenced API keys to the booted host.
      return agentSessionManager.syncProviderKeyEnv()
    })
    .catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Quitting mid-run kills agent hosts and discards queued prompts, so confirm
// first; "Quit anyway" re-enters this handler with the flag set.
let quitConfirmed = false
app.on('before-quit', (e) => {
  if (!quitConfirmed && agentSessionManager.anyRunning()) {
    e.preventDefault()
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Cancel', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'An agent is still running',
      detail: 'Quitting now stops the active run and discards any queued prompts.'
    })
    if (choice === 1) {
      quitConfirmed = true
      app.quit()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      // Cancelled after the last window closed (Windows/Linux close-to-quit):
      // reopen a window so the app isn't left running headless with no dock
      // icon to bring it back.
      createWindow()
    }
    return
  }
  agentSessionManager.shutdownAll()
  ptyManager.killAll()
  closeDb()
})
