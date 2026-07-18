/** Auto-updates via GitHub Releases (packaged builds only). */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export function initUpdater(): void {
  if (!app.isPackaged) return
  // No publish config (electron-builder `publish: null`) means no update
  // feed; electron-updater would just throw ENOENT on every launch.
  if (!existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return
  // Lazy import so dev runs never touch electron-updater.
  import('electron-updater')
    .then((mod) => {
      // electron-updater is CJS; depending on how the dynamic import is
      // resolved in the packaged build, the export may sit on `default`.
      const autoUpdater =
        mod.autoUpdater ??
        (mod as unknown as { default?: { autoUpdater?: typeof mod.autoUpdater } }).default
          ?.autoUpdater
      if (!autoUpdater) {
        console.warn('[updater] autoUpdater export not available; skipping update check')
        return
      }
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.error('[updater] check failed', err)
      })
    })
    .catch((err) => console.error('[updater] unavailable', err))
}
