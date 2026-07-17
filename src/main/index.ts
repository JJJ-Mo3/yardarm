import { app, BrowserWindow } from 'electron'
import { createIPCHandler } from 'trpc-electron/main'
import { initDb, closeDb } from './lib/db'
import { appRouter } from './lib/trpc/routers'
import { agentSessionManager } from './lib/agent/agent-session-manager'
import { ptyManager } from './lib/terminal/pty-manager'
import { createWindow, setIpcHandler } from './windows/window-manager'
import { initUpdater } from './lib/updater'

app.whenReady().then(() => {
  app.setAppUserModelId('dev.codezero.app')

  initDb()

  const handler = createIPCHandler({ router: appRouter, windows: [] })
  setIpcHandler(handler)

  createWindow()
  initUpdater()

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
