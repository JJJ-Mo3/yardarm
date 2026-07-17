/** Auto-updates via GitHub Releases (packaged builds only). */
import { app } from 'electron'

export function initUpdater(): void {
  if (!app.isPackaged) return
  // Lazy import so dev runs never touch electron-updater.
  import('electron-updater')
    .then(({ autoUpdater }) => {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.error('[updater] check failed', err)
      })
    })
    .catch((err) => console.error('[updater] unavailable', err))
}
