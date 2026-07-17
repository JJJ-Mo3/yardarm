import { contextBridge, ipcRenderer } from 'electron'
import { exposeElectronTRPC } from 'trpc-electron/main'

process.once('loaded', () => {
  exposeElectronTRPC()
})

contextBridge.exposeInMainWorld('codezero', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node
  },
  send: (channel: string, ...args: unknown[]) => {
    if (channel.startsWith('codezero:')) ipcRenderer.send(channel, ...args)
  }
})
