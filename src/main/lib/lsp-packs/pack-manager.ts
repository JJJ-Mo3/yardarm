/**
 * Manages optional downloadable language-server packs (src/shared/lsp-packs.ts).
 *
 * Packs are per-release zip assets (scripts/build-lsp-packs.mjs) installed
 * under <userData>/lsp-servers/<packId>/<version>/ — a self-contained
 * node_modules tree plus a pack.json manifest. Installs extract into a
 * sibling `*.tmp-*` directory and atomically rename into place, so a
 * half-written install is never resolvable by the agent hosts (which require
 * pack.json — see src/main/agent-host/lsp-pack-resolve.ts). Agent hosts pick
 * new installs up on the next diagnostics request with no restart.
 *
 * The release lookup tries the app's own tag (`v<appVersion>`) first so the
 * pack version matches this build's pins, then falls back to the latest
 * release. Download/extract run as fire-and-forget jobs polled by the
 * renderer via the lspPacks tRPC router (same pattern as update-manager).
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  LSP_PACKS,
  packAssetName,
  type LspPackDef,
  type LspPackId
} from '../../../shared/lsp-packs'
import { downloadAsset } from '../updates/download'
import { fetchLatestRelease, fetchReleaseByTag, pickPackAsset } from '../updates/github-release'

const execFileAsync = promisify(execFile)

export type LspPackPhase = 'idle' | 'downloading' | 'extracting' | 'error'

export interface LspPackStatus {
  id: LspPackId
  name: string
  languages: string[]
  approxSizeMb: number
  /** The catalog version this app build pins (what a download installs). */
  version: string
  /** Newest complete install on disk, if any. */
  installedVersion?: string
  phase: LspPackPhase
  /** Download progress 0..1 while phase === 'downloading'. */
  progress?: number
  error?: string
}

/** Injection points so the vitest suite can drive the job state machine. */
export interface LspPackManagerDeps {
  rootDir: string
  appVersion: string
  fetchReleaseByTag: typeof fetchReleaseByTag
  fetchLatestRelease: typeof fetchLatestRelease
  downloadAsset: typeof downloadAsset
  extractZip: (zipPath: string, destDir: string) => Promise<void>
}

async function dittoExtract(zipPath: string, destDir: string): Promise<void> {
  await execFileAsync('ditto', ['-x', '-k', zipPath, destDir])
}

interface PackJob {
  phase: 'downloading' | 'extracting'
  progress?: number
  abort: AbortController
  done: Promise<void>
}

/** Descending "newest first" order for dotted numeric version dir names. */
function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (Number.isNaN(da) || Number.isNaN(db)) return a < b ? 1 : -1
    if (da !== db) return db - da
  }
  return 0
}

export class LspPackManager {
  private jobs = new Map<LspPackId, PackJob>()
  private errors = new Map<LspPackId, string>()

  constructor(private deps: LspPackManagerDeps) {}

  list(): LspPackStatus[] {
    return LSP_PACKS.map((pack) => {
      const job = this.jobs.get(pack.id)
      const error = this.errors.get(pack.id)
      return {
        id: pack.id,
        name: pack.name,
        languages: pack.languages,
        approxSizeMb: pack.approxSizeMb,
        version: pack.version,
        installedVersion: this.installedVersion(pack.id),
        phase: job?.phase ?? (error ? 'error' : 'idle'),
        progress: job?.progress,
        error: job ? undefined : error
      }
    })
  }

  /** Newest complete (pack.json present) version dir, if any. */
  private installedVersion(packId: LspPackId): string | undefined {
    const packDir = path.join(this.deps.rootDir, packId)
    let versions: string[]
    try {
      versions = readdirSync(packDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.includes('.tmp-'))
        .map((d) => d.name)
        .filter((v) => existsSync(path.join(packDir, v, 'pack.json')))
    } catch {
      return undefined
    }
    return versions.sort(compareVersionsDesc)[0]
  }

  /** Fire-and-forget: kicks off a download job; poll list() for progress. */
  startDownload(packId: LspPackId): void {
    if (this.jobs.has(packId)) return
    const pack = LSP_PACKS.find((p) => p.id === packId)
    if (!pack) return
    this.errors.delete(packId)
    const job: PackJob = {
      phase: 'downloading',
      progress: 0,
      abort: new AbortController(),
      done: Promise.resolve()
    }
    this.jobs.set(packId, job)
    job.done = this.runDownload(pack, job).finally(() => {
      if (this.jobs.get(packId) === job) this.jobs.delete(packId)
    })
  }

  private async runDownload(pack: LspPackDef, job: PackJob): Promise<void> {
    const packDir = path.join(this.deps.rootDir, pack.id)
    const stamp = `.tmp-${process.pid}-${Date.now()}`
    const tmpZip = path.join(packDir, `zip${stamp}`)
    const tmpDir = path.join(packDir, `dir${stamp}`)
    try {
      await fs.mkdir(packDir, { recursive: true })
      // The app's own release should carry exactly the pinned pack version;
      // older/newer apps fall back to whatever the latest release ships.
      let release = await this.deps.fetchReleaseByTag(`v${this.deps.appVersion}`).catch(() => null)
      let pick = release ? pickPackAsset(release.assets, pack) : null
      if (!pick) {
        release = await this.deps.fetchLatestRelease()
        pick = release ? pickPackAsset(release.assets, pack) : null
      }
      if (!pick) {
        throw new Error(
          `No ${packAssetName(pack)} asset found on GitHub releases — try again after the next Yardarm release, or file an issue.`
        )
      }
      await this.deps.downloadAsset(
        pick.asset,
        tmpZip,
        (fraction) => {
          job.progress = fraction
        },
        job.abort.signal
      )
      job.phase = 'extracting'
      job.progress = undefined
      await this.deps.extractZip(tmpZip, tmpDir)
      if (!existsSync(path.join(tmpDir, 'node_modules', pack.pkg, 'package.json'))) {
        throw new Error(`Pack zip did not contain ${pack.pkg}`)
      }
      // pack.json marks the install complete; the build script writes one
      // into the zip, but synthesize it for hand-rolled zips too.
      const manifest = path.join(tmpDir, 'pack.json')
      if (!existsSync(manifest)) {
        await fs.writeFile(
          manifest,
          JSON.stringify({ id: pack.id, pkg: pack.pkg, version: pick.version }, null, 2)
        )
      }
      const versionDir = path.join(packDir, pick.version)
      await fs.rm(versionDir, { recursive: true, force: true })
      await fs.rename(tmpDir, versionDir)
      // Older versions are superseded — free the disk (best-effort; a server
      // already running from one keeps serving via its open inodes).
      for (const entry of readdirSync(packDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== pick.version && !entry.name.includes('.tmp-')) {
          await fs
            .rm(path.join(packDir, entry.name), { recursive: true, force: true })
            .catch(() => {})
        }
      }
    } catch (err) {
      if (!job.abort.signal.aborted) {
        this.errors.set(pack.id, err instanceof Error ? err.message : String(err))
      }
    } finally {
      await fs.rm(tmpZip, { force: true }).catch(() => {})
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Aborts an in-flight download; partial files are cleaned by the job. */
  cancel(packId: LspPackId): void {
    this.jobs.get(packId)?.abort.abort()
  }

  /** Deletes every installed version of a pack (and any stale error). */
  async remove(packId: LspPackId): Promise<void> {
    this.cancel(packId)
    await this.jobs.get(packId)?.done
    this.errors.delete(packId)
    await fs.rm(path.join(this.deps.rootDir, packId), { recursive: true, force: true })
  }

  /** Removes `*.tmp-*` leftovers from interrupted installs (run at startup). */
  async cleanupPartial(): Promise<void> {
    let packIds: string[]
    try {
      packIds = readdirSync(this.deps.rootDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return
    }
    for (const packId of packIds) {
      const packDir = path.join(this.deps.rootDir, packId)
      let entries: string[]
      try {
        entries = readdirSync(packDir)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.includes('.tmp-')) {
          await fs.rm(path.join(packDir, entry), { recursive: true, force: true }).catch(() => {})
        }
      }
    }
  }
}

let singleton: LspPackManager | undefined

/**
 * Production singleton rooted at <userData>/lsp-servers — the same directory
 * agent-session-manager passes to every host as boot.lspServersDir.
 */
export async function getLspPackManager(): Promise<LspPackManager> {
  if (!singleton) {
    const { app } = await import('electron')
    singleton = new LspPackManager({
      rootDir: path.join(app.getPath('userData'), 'lsp-servers'),
      appVersion: app.getVersion(),
      fetchReleaseByTag,
      fetchLatestRelease,
      downloadAsset,
      extractZip: dittoExtract
    })
  }
  return singleton
}
