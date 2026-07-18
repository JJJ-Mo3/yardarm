import { contextBridge, ipcRenderer } from 'electron'
import { exposeElectronTRPC } from 'trpc-electron/main'

process.once('loaded', () => {
  exposeElectronTRPC()
})

contextBridge.exposeInMainWorld('yardarm', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node
  },
  send: (channel: string, ...args: unknown[]) => {
    if (channel.startsWith('yardarm:')) ipcRenderer.send(channel, ...args)
  }
})
