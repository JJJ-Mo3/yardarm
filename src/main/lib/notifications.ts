/**
 * Main-process desktop notifications for background agent activity (run
 * finished, approval needed, input needed). Fired from the session manager,
 * gated on the `desktopNotifications` app setting (default on), suppressed
 * while any app window is focused, and coalesced so event bursts show a
 * single banner. Clicking a notification focuses the window and asks the
 * renderer (via the agent.focusRequests subscription) to select the chat.
 */
import { EventEmitter } from 'node:events'
import { BrowserWindow, Notification } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb, schema } from './db'

export interface FocusChatRequest {
  chatId: string
  subchatId: string
}

/** Minimum gap between banners so one turn's event burst shows only one. */
const COALESCE_MS = 2000
let lastShownAt = 0

const focusEmitter = new EventEmitter()

/** Renderer-bound focus requests from clicked notifications. */
export function onFocusChat(listener: (req: FocusChatRequest) => void): () => void {
  focusEmitter.on('focus', listener)
  return () => focusEmitter.off('focus', listener)
}

/** Reads the `desktopNotifications` app setting; absent or corrupt means on. */
function notificationsEnabled(): boolean {
  try {
    const row = getDb()
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, 'desktopNotifications'))
      .get()
    if (!row) return true
    return (JSON.parse(row.value) as unknown) !== false
  } catch {
    return true
  }
}

/** Shows a notification for an agent event unless the user is already looking. */
export function notifyAgentEvent(body: string, chatId: string, subchatId: string): void {
  if (!Notification.isSupported()) return
  if (BrowserWindow.getFocusedWindow()) return
  if (!notificationsEnabled()) return
  const now = Date.now()
  if (now - lastShownAt < COALESCE_MS) return
  lastShownAt = now

  const n = new Notification({ title: 'Yardarm', body })
  n.on('click', () => {
    // No window means no live focusRequests subscriber either — skip.
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    focusEmitter.emit('focus', { chatId, subchatId } satisfies FocusChatRequest)
  })
  n.show()
}
