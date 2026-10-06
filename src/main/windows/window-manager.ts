import path from 'node:path'
import { BrowserWindow, session, shell } from 'electron'
import type { createIPCHandler } from 'trpc-electron/main'
import { isLocalhostHttpUrl } from '../../shared/localhost-url'
import { registerPreviewGuest, unregisterPreviewGuest } from './preview-guests'
import { webviewNavAction } from './webview-nav-policy'
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
      // The Preview and Factory tabs render <webview>s; the
      // will/did-attach-webview handlers below are the enforcement point for
      // what they may load.
      webviewTag: true
    }
  })

  // <webview> hardening (Preview + Factory tabs): strip any preload, force
  // isolation, and only let localhost documents attach. Navigation policy is
  // per-kind (webview-nav-policy.ts): Preview stays localhost-only; the
  // Factory dashboard may also follow its https sign-in redirect chain
  // in-place. This lives in the main process because the renderer-side
  // webview events are not cancelable.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    const src = typeof params.src === 'string' ? params.src : ''
    if (src && src !== 'about:blank' && !isLocalhostHttpUrl(src)) event.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_event, guest) => {
    // Captured here — a destroyed webContents throws on property access.
    const guestId = guest.id
    registerPreviewGuest(guestId)
    guest.on('destroyed', () => unregisterPreviewGuest(guestId))
    // The Factory dashboard is the only guest on the persist:factory
    // partition (FactoryRunPanel); its sign-in needs https in-webview.
    const kind = guest.session === session.fromPartition('persist:factory') ? 'factory' : 'preview'
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url).catch(() => {})
      }
      return { action: 'deny' }
    })
    const applyNavPolicy = (ev: { preventDefault: () => void }, url: string): void => {
      const action = webviewNavAction(url, kind)
      if (action === 'allow') return
      ev.preventDefault()
      if (action === 'external') shell.openExternal(url).catch(() => {})
    }
    guest.on('will-navigate', applyNavPolicy)
    // Server-side redirects (301/302) fire will-redirect, not will-navigate —
    // without this a localhost page could redirect the webview anywhere.
    guest.on('will-redirect', applyNavPolicy)
  })

  ipcHandler?.attachWindow(win)

  // Renderer crash recovery: after long sessions the renderer process can die
  // (V8 OOM from a huge transcript, macOS memory pressure while idle), which
  // otherwise leaves a permanently blank window until the app is restarted.
  // Reload instead — the tRPC stream re-seeds the transcript from SQLite.
  // Capped at 3 reloads/minute so a deterministic crash can't loop forever.
  const crashReloads: number[] = []
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    console.error(
      `[window] renderer gone (reason=${details.reason}, exitCode=${details.exitCode}) — reloading`
    )
    const now = Date.now()
    while (crashReloads.length > 0 && now - crashReloads[0] > 60_000) crashReloads.shift()
    if (crashReloads.length >= 3) {
      console.error('[window] renderer crashed 3+ times in a minute — giving up on auto-reload')
      return
    }
    crashReloads.push(now)
    win.webContents.reload()
  })

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
