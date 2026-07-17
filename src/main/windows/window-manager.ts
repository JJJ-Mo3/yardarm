import path from 'node:path'
import { BrowserWindow, shell } from 'electron'
import type { createIPCHandler } from 'trpc-electron/main'

type IPCHandler = ReturnType<typeof createIPCHandler>

let ipcHandler: IPCHandler | null = null

export function setIpcHandler(handler: IPCHandler): void {
  ipcHandler = handler
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  ipcHandler?.attachWindow(win)

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    // trpc-electron detaches destroyed windows automatically; nothing to do.
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}
