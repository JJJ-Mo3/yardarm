import { app, BrowserWindow } from 'electron'
import { createIPCHandler } from 'trpc-electron/main'
import { initDb, closeDb, maintainDb } from './lib/db'
import { appRouter } from './lib/trpc/routers'
import { agentSessionManager } from './lib/agent/agent-session-manager'
import { normalizeModelIdsInSettings } from './lib/mastra-config/normalize-model-ids'
import { ptyManager } from './lib/terminal/pty-manager'
import { createWindow, setIpcHandler } from './windows/window-manager'
import { updateManager } from './lib/updates/update-manager'
import icon from '../../build/icon.png?asset'

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

  // Heal gateway-prefixed model ids saved before catalog normalization, then
  // warm up + verify the bundled mastracode runtime (hosts read settings.json
  // at boot, so the migration runs before the first host spawns); renderer
  // preflight queries reuse the booted utility host.
  normalizeModelIdsInSettings()
    .catch(() => {})
    .then(() => agentSessionManager.preflight())
    .then((res) => {
      if (!res.ok) console.error('[preflight] mastracode boot failed:', res.error)
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  agentSessionManager.shutdownAll()
  ptyManager.killAll()
  closeDb()
})
