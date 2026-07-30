import { describe, expect, it } from 'vitest'
import { LSP_PACKS, packAssetName } from '../../../shared/lsp-packs'
import { pickMacZipAsset, pickPackAsset, type ReleaseAsset } from './github-release'

const asset = (name: string): ReleaseAsset => ({
  name,
  browser_download_url: `https://example.com/${name}`,
  size: 1
})

describe('pickMacZipAsset', () => {
  it('prefers the pinned artifactName shape', () => {
    const assets = [
      asset('Yardarm-0.1.1-arm64.dmg'),
      asset('Yardarm-0.1.1-arm64-mac.zip'),
      asset('Yardarm-0.1.1-arm64.zip')
    ]
    expect(pickMacZipAsset(assets, 'arm64')?.name).toBe('Yardarm-0.1.1-arm64.zip')
  })

  it('falls back to the electron-builder default -arch-mac.zip shape', () => {
    const assets = [asset('Yardarm-0.1.1-arm64-mac.zip'), asset('Yardarm-0.1.1-x64-mac.zip')]
    expect(pickMacZipAsset(assets, 'arm64')?.name).toBe('Yardarm-0.1.1-arm64-mac.zip')
  })

  it('falls back to any zip mentioning the arch, then any mac/darwin zip', () => {
    expect(pickMacZipAsset([asset('yardarm_arm64_build.zip')], 'arm64')?.name).toBe(
      'yardarm_arm64_build.zip'
    )
    expect(pickMacZipAsset([asset('Yardarm-mac.zip')], 'arm64')?.name).toBe('Yardarm-mac.zip')
    expect(pickMacZipAsset([asset('Yardarm-darwin.zip')], 'arm64')?.name).toBe('Yardarm-darwin.zip')
  })

  it('prefers the arch match over a loose mac match on mixed releases', () => {
    const assets = [asset('Yardarm-1.0.0-x64-mac.zip'), asset('Yardarm-1.0.0-arm64.zip')]
    expect(pickMacZipAsset(assets, 'arm64')?.name).toBe('Yardarm-1.0.0-arm64.zip')
  })

  it('ignores non-zip assets and wrong arch', () => {
    expect(pickMacZipAsset([asset('Yardarm-0.1.1-arm64.dmg')], 'arm64')).toBeNull()
    expect(pickMacZipAsset([asset('Yardarm-0.1.1-x64.zip')], 'arm64')).toBeNull()
    expect(pickMacZipAsset([], 'arm64')).toBeNull()
  })

  it('never selects an LSP pack zip, even via the loose fallbacks', () => {
    const packAssets = LSP_PACKS.map((p) => asset(packAssetName(p)))
    expect(pickMacZipAsset(packAssets, 'arm64')).toBeNull()
    const mixed = [...packAssets, asset('Yardarm-1.0.0-arm64.zip')]
    expect(pickMacZipAsset(mixed, 'arm64')?.name).toBe('Yardarm-1.0.0-arm64.zip')
  })
})

describe('pickPackAsset', () => {
  const yaml = LSP_PACKS.find((p) => p.id === 'yaml')!

  it('prefers the exact catalog asset name and reports the pinned version', () => {
    const assets = [asset('Yardarm-1.0.0-arm64.zip'), asset(packAssetName(yaml))]
    const pick = pickPackAsset(assets, yaml)
    expect(pick?.asset.name).toBe(`lsp-pack-yaml-${yaml.version}.zip`)
    expect(pick?.version).toBe(yaml.version)
  })

  it('falls back to any lsp-pack-<id>-*.zip and parses the real version', () => {
    const pick = pickPackAsset([asset('lsp-pack-yaml-9.9.9.zip')], yaml)
    expect(pick?.asset.name).toBe('lsp-pack-yaml-9.9.9.zip')
    expect(pick?.version).toBe('9.9.9')
  })

  it('never picks another pack or app zips', () => {
    const assets = [
      asset('lsp-pack-python-1.1.411.zip'),
      asset('Yardarm-1.0.0-arm64.zip'),
      asset('Yardarm-1.0.0-arm64.dmg')
    ]
    expect(pickPackAsset(assets, yaml)).toBeNull()
    expect(pickPackAsset([], yaml)).toBeNull()
  })
})
