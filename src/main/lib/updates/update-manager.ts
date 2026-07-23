/**
 * Singleton orchestrating in-app updates: checks the GitHub Releases API,
 * downloads + stages + swaps the .app bundle (install-mac.ts), and exposes a
 * polled UpdateStatus to the renderer via the updates tRPC router. The
 * "Automatically update" preference lives in the app_settings KV table.
 * Auto-update goes check → download → ready-to-restart; the actual relaunch
 * is always a user click.
 */
import { eq } from 'drizzle-orm'
import { app } from 'electron'
import { getDb, schema } from '../db'
import { fetchLatestRelease, pickMacZipAsset, type ReleaseInfo } from './github-release'
import { cleanupStaleBundles, downloadAndStage, getBundlePath, swapBundle } from './install-mac'
import { isNewerVersion } from './semver'

const AUTO_UPDATE_KEY = 'updates.autoUpdate'
const AUTO_CHECK_INITIAL_MS = 12_000
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'installing'
  | 'ready-to-restart'
  | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  releaseNotes?: string
  error?: string
  /** Download progress 0..1 while phase === 'downloading'. */
  progress?: number
  /** False in dev builds, off macOS, or when running translocated. */
  canInstall: boolean
  autoUpdate: boolean
}

class UpdateManager {
  private phase: UpdatePhase = 'idle'
  private latest: ReleaseInfo | null = null
  private error?: string
  private progress?: number
  private autoUpdate = true
  private checkInFlight: Promise<void> | null = null
  private installing = false

  /** Call once after initDb(): loads the preference and starts auto timers. */
  init(): void {
    try {
      const row = getDb()
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, AUTO_UPDATE_KEY))
        .get()
      if (row) this.autoUpdate = JSON.parse(row.value) === true
    } catch {}
    void cleanupStaleBundles()
    if (!this.canInstall()) return
    setTimeout(() => void this.autoTick(), AUTO_CHECK_INITIAL_MS).unref()
    setInterval(() => void this.autoTick(), AUTO_CHECK_INTERVAL_MS).unref()
  }

  getStatus(): UpdateStatus {
    return {
      phase: this.phase,
      currentVersion: app.getVersion(),
      latestVersion: this.latest?.tagName.replace(/^v/, ''),
      releaseUrl: this.latest?.htmlUrl,
      releaseNotes: this.latest?.body.slice(0, 4000),
      error: this.error,
      progress: this.progress,
      canInstall: this.canInstall(),
      autoUpdate: this.autoUpdate
    }
  }

  async check(): Promise<UpdateStatus> {
    if (!this.checkInFlight) {
      this.checkInFlight = this.doCheck().finally(() => {
        this.checkInFlight = null
      })
    }
    await this.checkInFlight
    return this.getStatus()
  }

  private async doCheck(): Promise<void> {
    if (this.installing || this.phase === 'ready-to-restart') return
    this.phase = 'checking'
    this.error = undefined
    try {
      const release = await fetchLatestRelease()
      this.latest = release
      this.phase =
        release && isNewerVersion(app.getVersion(), release.tagName)
          ? 'update-available'
          : 'up-to-date'
    } catch (err) {
      this.phase = 'error'
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  async downloadAndInstall(): Promise<UpdateStatus> {
    if (this.installing || this.phase === 'ready-to-restart') return this.getStatus()
    const release = this.latest
    if (this.phase !== 'update-available' || !release) return this.getStatus()
    this.installing = true
    try {
      if (!this.canInstall()) {
        throw new Error('This build cannot self-update — download the release manually.')
      }
      const asset = pickMacZipAsset(release.assets, process.arch)
      if (!asset) {
        throw new Error(`No macOS ${process.arch} zip asset on release ${release.tagName}`)
      }
      this.phase = 'downloading'
      this.progress = 0
      this.error = undefined
      const staged = await downloadAndStage(
        asset,
        (fraction) => {
          this.progress = fraction
        },
        () => {
          // Network done; extract + stage are the slow local phases.
          this.phase = 'installing'
          this.progress = undefined
        }
      )
      await swapBundle(staged)
      this.phase = 'ready-to-restart'
    } catch (err) {
      this.phase = 'error'
      this.progress = undefined
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.installing = false
    }
    return this.getStatus()
  }

  setAutoUpdate(enabled: boolean): void {
    this.autoUpdate = enabled
    try {
      const db = getDb()
      const value = JSON.stringify(enabled)
      const existing = db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, AUTO_UPDATE_KEY))
        .get()
      if (existing) {
        db.update(schema.appSettings)
          .set({ value })
          .where(eq(schema.appSettings.key, AUTO_UPDATE_KEY))
          .run()
      } else {
        db.insert(schema.appSettings).values({ key: AUTO_UPDATE_KEY, value }).run()
      }
    } catch {}
    if (enabled && this.canInstall()) void this.autoTick()
  }

  private async autoTick(): Promise<void> {
    if (!this.autoUpdate || this.installing || this.phase === 'ready-to-restart') return
    await this.check()
    if (this.phase === 'update-available' && this.canInstall()) {
      await this.downloadAndInstall()
    }
  }

  private canInstall(): boolean {
    if (!app.isPackaged || process.platform !== 'darwin') return false
    try {
      getBundlePath()
      return true
    } catch {
      return false
    }
  }
}

export const updateManager = new UpdateManager()
