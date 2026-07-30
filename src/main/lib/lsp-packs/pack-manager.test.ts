/**
 * Drives the LspPackManager job state machine through injected deps: no
 * network, no ditto — downloadAsset/extractZip are fakes writing into a temp
 * rootDir. Covers progress reporting, the tag→latest release fallback,
 * tmp→rename atomicity, cancel, error surfacing, remove and cleanupPartial.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseAsset, ReleaseInfo } from '../updates/github-release'
import { LspPackManager, type LspPackManagerDeps, type LspPackStatus } from './pack-manager'

const YAML_PKG = 'yaml-language-server'
const YAML_VERSION = '1.24.0'

let root: string

const release = (assetNames: string[]): ReleaseInfo => ({
  tagName: 'v0.0.0',
  htmlUrl: '',
  body: '',
  assets: assetNames.map((name): ReleaseAsset => ({
    name,
    browser_download_url: `https://example.com/${name}`,
    size: 3
  }))
})

/** downloadAsset fake: reports full progress and writes a placeholder zip. */
const writeZip: LspPackManagerDeps['downloadAsset'] = async (_asset, dest, onProgress) => {
  onProgress?.(1)
  await fs.writeFile(dest, 'zip')
}

/** extractZip fake: lays out the node_modules tree a real pack zip contains. */
const extractYaml =
  (opts: { manifest?: boolean } = {}): LspPackManagerDeps['extractZip'] =>
  async (_zipPath, destDir) => {
    mkdirSync(path.join(destDir, 'node_modules', YAML_PKG), { recursive: true })
    writeFileSync(path.join(destDir, 'node_modules', YAML_PKG, 'package.json'), '{}')
    if (opts.manifest) writeFileSync(path.join(destDir, 'pack.json'), '{}')
  }

function manager(overrides: Partial<LspPackManagerDeps> = {}): LspPackManager {
  return new LspPackManager({
    rootDir: root,
    appVersion: '0.0.0',
    fetchReleaseByTag: async () => release([`lsp-pack-yaml-${YAML_VERSION}.zip`]),
    fetchLatestRelease: async () => null,
    downloadAsset: writeZip,
    extractZip: extractYaml(),
    ...overrides
  })
}

const yamlStatus = (m: LspPackManager): LspPackStatus => m.list().find((p) => p.id === 'yaml')!

const waitIdle = (m: LspPackManager): Promise<void> =>
  vi.waitFor(() => {
    const phase = yamlStatus(m).phase
    if (phase === 'downloading' || phase === 'extracting') throw new Error('still running')
  })

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'lsp-pack-mgr-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('LspPackManager', () => {
  it('lists the whole catalog as idle with nothing installed', () => {
    const m = manager()
    const statuses = m.list()
    expect(statuses.map((p) => p.id)).toEqual(['web', 'yaml', 'python', 'erb'])
    for (const s of statuses) {
      expect(s.phase).toBe('idle')
      expect(s.installedVersion).toBeUndefined()
    }
  })

  it('downloads, extracts and atomically installs a pack', async () => {
    const m = manager()
    m.startDownload('yaml')
    await waitIdle(m)
    const s = yamlStatus(m)
    expect(s.phase).toBe('idle')
    expect(s.error).toBeUndefined()
    expect(s.installedVersion).toBe(YAML_VERSION)
    const versionDir = path.join(root, 'yaml', YAML_VERSION)
    expect(existsSync(path.join(versionDir, 'node_modules', YAML_PKG, 'package.json'))).toBe(true)
    // pack.json synthesized when the zip lacks one.
    expect(existsSync(path.join(versionDir, 'pack.json'))).toBe(true)
    // No tmp leftovers.
    const entries = await fs.readdir(path.join(root, 'yaml'))
    expect(entries).toEqual([YAML_VERSION])
  })

  it('reports download progress and the extracting phase', async () => {
    let releaseProgress: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseProgress = resolve
    })
    const m = manager({
      downloadAsset: async (_a, dest, onProgress) => {
        onProgress?.(0.4)
        await gate
        await fs.writeFile(dest, 'zip')
      }
    })
    m.startDownload('yaml')
    await vi.waitFor(() => {
      const s = yamlStatus(m)
      expect(s.phase).toBe('downloading')
      expect(s.progress).toBe(0.4)
    })
    releaseProgress!()
    await waitIdle(m)
    expect(yamlStatus(m).installedVersion).toBe(YAML_VERSION)
  })

  it('falls back to the latest release when the app tag has no pack asset', async () => {
    const m = manager({
      fetchReleaseByTag: async () => null,
      fetchLatestRelease: async () => release(['lsp-pack-yaml-9.9.9.zip'])
    })
    m.startDownload('yaml')
    await waitIdle(m)
    // The installed version dir comes from the asset actually downloaded.
    expect(yamlStatus(m).installedVersion).toBe('9.9.9')
  })

  it('surfaces a clear error when no release carries the asset', async () => {
    const m = manager({
      fetchReleaseByTag: async () => null,
      fetchLatestRelease: async () => release(['Yardarm-1.0.0-arm64.zip'])
    })
    m.startDownload('yaml')
    await waitIdle(m)
    const s = yamlStatus(m)
    expect(s.phase).toBe('error')
    expect(s.error).toContain(`lsp-pack-yaml-${YAML_VERSION}.zip`)
    expect(s.installedVersion).toBeUndefined()
    // Retrying clears the error.
    m.startDownload('yaml')
    await waitIdle(m)
    expect(yamlStatus(m).phase).toBe('error')
  })

  it('cancel aborts the download without recording an error', async () => {
    const m = manager({
      downloadAsset: (_a, _d, _p, signal) =>
        new Promise((_resolve, reject) => {
          // Like net.fetch: reject immediately when the signal is already
          // aborted (cancel can land before the job reaches the download).
          const onAbort = (): void => reject(new Error('aborted'))
          if (signal?.aborted) onAbort()
          else signal?.addEventListener('abort', onAbort)
        })
    })
    m.startDownload('yaml')
    await vi.waitFor(() => expect(yamlStatus(m).phase).toBe('downloading'))
    m.cancel('yaml')
    await waitIdle(m)
    const s = yamlStatus(m)
    expect(s.phase).toBe('idle')
    expect(s.error).toBeUndefined()
    expect(s.installedVersion).toBeUndefined()
  })

  it('replaces older installed versions after a successful install', async () => {
    const old = path.join(root, 'yaml', '1.0.0')
    mkdirSync(old, { recursive: true })
    writeFileSync(path.join(old, 'pack.json'), '{}')
    const m = manager()
    expect(yamlStatus(m).installedVersion).toBe('1.0.0')
    m.startDownload('yaml')
    await waitIdle(m)
    expect(yamlStatus(m).installedVersion).toBe(YAML_VERSION)
    expect(existsSync(old)).toBe(false)
  })

  it('remove deletes every installed version', async () => {
    const m = manager()
    m.startDownload('yaml')
    await waitIdle(m)
    expect(yamlStatus(m).installedVersion).toBe(YAML_VERSION)
    await m.remove('yaml')
    expect(yamlStatus(m).installedVersion).toBeUndefined()
    expect(existsSync(path.join(root, 'yaml'))).toBe(false)
  })

  it('cleanupPartial removes tmp leftovers but keeps complete installs', async () => {
    const keep = path.join(root, 'yaml', YAML_VERSION)
    mkdirSync(keep, { recursive: true })
    writeFileSync(path.join(keep, 'pack.json'), '{}')
    mkdirSync(path.join(root, 'yaml', 'dir.tmp-123'), { recursive: true })
    writeFileSync(path.join(root, 'yaml', 'zip.tmp-456'), '')
    const m = manager()
    await m.cleanupPartial()
    expect(await fs.readdir(path.join(root, 'yaml'))).toEqual([YAML_VERSION])
  })
})
