/**
 * macOS self-update installer for the unsigned Yardarm bundle. Downloads the
 * release zip programmatically (Electron net — no browser, so no quarantine
 * xattr), extracts it with `ditto -x -k`, stages the new .app NEXT TO the
 * installed bundle (guaranteeing the final swap is a same-volume rename; on
 * APFS the running process survives via its open inodes), then swaps:
 * current → Yardarm.app.old-<pid>, staged → current, restoring the old bundle
 * if the second rename fails. Refuses to run translocated (Gatekeeper app
 * translocation mounts a read-only randomized image; renaming there would be
 * pointless — the real bundle lives elsewhere).
 */
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { promisify } from 'node:util'
import type { ReleaseAsset } from './github-release'

const execFileAsync = promisify(execFile)

/**
 * Recursive delete via /bin/rm. Electron patches fs in the main process to
 * treat *.asar files as directories, so fs.rm on anything containing an
 * app.asar fails partway through; an external rm has no asar semantics.
 */
async function rmrf(target: string): Promise<void> {
  await execFileAsync('rm', ['-rf', '--', target])
}

/** Resolves Contents/MacOS/<bin> → the .app bundle root, with sanity checks. */
export function getBundlePath(): string {
  const execPath = process.execPath
  if (execPath.includes('/AppTranslocation/')) {
    throw new Error(
      'Yardarm is running translocated (opened from a quarantined location). ' +
        'Move Yardarm.app to /Applications and relaunch it once, then update.'
    )
  }
  const bundle = path.resolve(execPath, '..', '..', '..')
  if (!bundle.endsWith('.app')) {
    throw new Error(`Not running from an .app bundle (${bundle})`)
  }
  return bundle
}

async function assertLooksLikeApp(appPath: string): Promise<void> {
  await fs.access(path.join(appPath, 'Contents', 'Info.plist'))
  await fs.access(path.join(appPath, 'Contents', 'MacOS', 'Yardarm'))
}

/**
 * Downloads and verifies the zip, extracts it, and stages the contained .app
 * as a sibling of the installed bundle. Returns the staged path.
 * `onStageStart` fires once the network transfer is complete and the slow
 * local extract/stage work begins, so callers can flip their status phase.
 */
export async function downloadAndStage(
  asset: ReleaseAsset,
  onProgress?: (fraction: number) => void,
  onStageStart?: () => void
): Promise<string> {
  const bundle = getBundlePath()
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yardarm-update-'))
  try {
    const zipPath = path.join(tmp, asset.name)
    const { net } = await import('electron')
    const res = await net.fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'yardarm-updater' }
    })
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)

    let received = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        if (asset.size > 0) onProgress?.(Math.min(received / asset.size, 1))
        controller.enqueue(chunk)
      }
    })
    const body = res.body.pipeThrough(counter) as unknown as WebReadableStream<Uint8Array>
    await pipeline(Readable.fromWeb(body), createWriteStream(zipPath))

    const stat = await fs.stat(zipPath)
    if (asset.size > 0 && stat.size !== asset.size) {
      throw new Error(`Download incomplete (${stat.size} of ${asset.size} bytes)`)
    }

    onStageStart?.()
    const extractDir = path.join(tmp, 'extracted')
    await execFileAsync('ditto', ['-x', '-k', zipPath, extractDir])
    const entries = await fs.readdir(extractDir)
    const appName = entries.find((e) => e.endsWith('.app'))
    if (!appName) throw new Error('Update zip did not contain an .app bundle')
    const extractedApp = path.join(extractDir, appName)
    await assertLooksLikeApp(extractedApp)

    // Stage next to the installed bundle so the final swap is a same-volume
    // rename; ditto (not fs.rename) because the temp dir may be on another volume.
    const staged = `${bundle}.new`
    await rmrf(staged)
    await execFileAsync('ditto', [extractedApp, staged])
    await assertLooksLikeApp(staged)
    return staged
  } finally {
    await rmrf(tmp).catch(() => {})
  }
}

/** Atomically swaps the staged bundle into place. */
export async function swapBundle(stagedPath: string): Promise<void> {
  const bundle = getBundlePath()
  const old = `${bundle}.old-${process.pid}`
  await fs.rename(bundle, old)
  try {
    await fs.rename(stagedPath, bundle)
  } catch (err) {
    // Put the original back so the install never leaves a missing app.
    await fs.rename(old, bundle).catch(() => {})
    throw err
  }
  await rmrf(old).catch(() => {})
}

/** Removes leftovers from interrupted installs (best-effort, run at startup). */
export async function cleanupStaleBundles(): Promise<void> {
  try {
    const bundle = getBundlePath()
    const dir = path.dirname(bundle)
    const base = path.basename(bundle)
    for (const entry of await fs.readdir(dir)) {
      if (entry === `${base}.new` || entry.startsWith(`${base}.old-`)) {
        await rmrf(path.join(dir, entry)).catch(() => {})
      }
    }
  } catch {}
}
