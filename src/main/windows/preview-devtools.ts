/**
 * Hosts the Preview tab's docked DevTools in a main-process WebContentsView
 * overlaid on the app window. A <webview> cannot host another webContents'
 * DevTools frontend — Electron never injects the DevToolsAPI embedder binding
 * into guest webContents (electron/electron#15874), so the frontend loads but
 * shows empty panels. A WebContentsView owned by the main process gets the
 * binding, so the renderer renders a placeholder pane and reports its bounds
 * here; the overlay tracks them (0-sized bounds hide it while the Preview tab
 * is mounted but not visible).
 */
import { BrowserWindow, WebContentsView, webContents } from 'electron'

export interface DevToolsBounds {
  x: number
  y: number
  width: number
  height: number
}

interface Entry {
  view: WebContentsView
  win: BrowserWindow
  /** Removed on explicit close so listeners don't pile up across reopens. */
  onGone: () => void
}

/** Keyed by the inspected page's webContents id. */
const entries = new Map<number, Entry>()

/** Opens DevTools for the page in an overlay at bounds, or moves an existing one. */
export function openOrMovePreviewDevTools(pageId: number, bounds: DevToolsBounds): void {
  const existing = entries.get(pageId)
  if (existing) {
    existing.view.setBounds(bounds)
    return
  }
  const page = webContents.fromId(pageId)
  if (!page || page.isDestroyed()) throw new Error('Preview page is gone')
  const embedder = page.hostWebContents
  const win = embedder ? BrowserWindow.fromWebContents(embedder) : null
  if (!win || win.isDestroyed()) throw new Error('Preview window is gone')
  const view = new WebContentsView({
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  win.contentView.addChildView(view)
  view.setBounds(bounds)
  page.setDevToolsWebContents(view.webContents)
  page.openDevTools({ mode: 'detach' })
  const onGone = (): void => closePreviewDevTools(pageId)
  // Window close destroys the embedder, which destroys the guest, so a page
  // 'destroyed' listener covers both. 'devtools-closed' covers the frontend's
  // own close button.
  page.once('destroyed', onGone)
  page.once('devtools-closed', onGone)
  entries.set(pageId, { view, win, onGone })
}

/** Closes the overlay and destroys its webContents. No-op if none is open. */
export function closePreviewDevTools(pageId: number): void {
  const entry = entries.get(pageId)
  if (!entry) return
  entries.delete(pageId)
  const page = webContents.fromId(pageId)
  if (page && !page.isDestroyed()) {
    page.removeListener('destroyed', entry.onGone)
    page.removeListener('devtools-closed', entry.onGone)
    try {
      page.closeDevTools()
    } catch {}
  }
  try {
    if (!entry.win.isDestroyed()) entry.win.contentView.removeChildView(entry.view)
  } catch {}
  // Closing DevTools does not destroy a custom devtools webContents — that is
  // the caller's responsibility (Electron webContents docs).
  try {
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  } catch {}
}
