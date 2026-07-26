import path from 'node:path'
import { BrowserWindow, shell } from 'electron'
import type { createIPCHandler } from 'trpc-electron/main'
import { isLocalhostHttpUrl } from '../../shared/localhost-url'
import icon from '../../../build/icon.png?asset'

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
    // macOS uses the .icns from electron-builder; win/linux windows take
    // theirs from BrowserWindow options.
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Only the Preview tab renders a <webview>; the will/did-attach-webview
      // handlers below are the enforcement point for what it may load.
      webviewTag: true
    }
  })

  // <webview> hardening (Preview tab): strip any preload, force isolation,
  // and only let localhost documents attach or navigate. This lives in the
  // main process because the renderer-side webview events are not cancelable.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    const src = typeof params.src === 'string' ? params.src : ''
    if (src && src !== 'about:blank' && !isLocalhostHttpUrl(src)) event.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url).catch(() => {})
      }
      return { action: 'deny' }
    })
    guest.on('will-navigate', (ev, url) => {
      if (isLocalhostHttpUrl(url)) return
      ev.preventDefault()
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url).catch(() => {})
      }
    })
    // Server-side redirects (301/302) fire will-redirect, not will-navigate —
    // without this a localhost page could redirect the webview off localhost.
    guest.on('will-redirect', (ev, url) => {
      if (isLocalhostHttpUrl(url)) return
      ev.preventDefault()
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url).catch(() => {})
      }
    })
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

  // In-page link clicks (e.g. URLs in chat markdown) are same-window
  // navigations, which bypass setWindowOpenHandler: keep the app in place
  // and open http(s) links in the user's browser instead.
  const devOrigin = process.env['ELECTRON_RENDERER_URL']
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return // in-app reload (dev Cmd+R)
    event.preventDefault()
    if (!url.startsWith('http://') && !url.startsWith('https://')) return
    if (devOrigin && url.startsWith(devOrigin)) return
    shell.openExternal(url).catch(() => {})
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}
