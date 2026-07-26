/**
 * Registry of attached Preview <webview> guest webContents ids, so tRPC
 * procedures acting on a guest (DevTools toggle) can verify the target really
 * is one. Lives outside window-manager.ts because the renderer's AppRouter
 * type pulls router imports into tsconfig.web, which can't resolve the
 * `?asset` import window-manager uses.
 */

const previewGuests = new Set<number>()

export function registerPreviewGuest(webContentsId: number): void {
  previewGuests.add(webContentsId)
}

export function unregisterPreviewGuest(webContentsId: number): void {
  previewGuests.delete(webContentsId)
}

export function isPreviewGuest(webContentsId: number): boolean {
  return previewGuests.has(webContentsId)
}
