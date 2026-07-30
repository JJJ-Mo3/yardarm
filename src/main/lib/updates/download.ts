/**
 * Shared GitHub release-asset downloader: Electron net.fetch (programmatic —
 * no browser, so no quarantine xattr) with byte-counting progress, abort
 * support, and a size check. Used by the app updater (install-mac.ts) and
 * the optional LSP pack manager (src/main/lib/lsp-packs).
 */
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { ReleaseAsset } from './github-release'

export async function downloadAsset(
  asset: ReleaseAsset,
  destPath: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<void> {
  // Lazy so this module stays importable from vitest.
  const { net } = await import('electron')
  const res = await net.fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'yardarm-updater' },
    signal
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
  await pipeline(Readable.fromWeb(body), createWriteStream(destPath), { signal })

  const stat = await fs.stat(destPath)
  if (asset.size > 0 && stat.size !== asset.size) {
    throw new Error(`Download incomplete (${stat.size} of ${asset.size} bytes)`)
  }
}
