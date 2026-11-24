/**
 * Sandboxed preload: exposes the tRPC IPC bridge plus read-only platform
 * info. Nothing else crosses the context boundary.
 */
import { contextBridge } from 'electron'
import { exposeElectronTRPC } from 'trpc-electron/main'

process.once('loaded', () => {
  exposeElectronTRPC()
})

contextBridge.exposeInMainWorld('yardarm', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node
  }
})
