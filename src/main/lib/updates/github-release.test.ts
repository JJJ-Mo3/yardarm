import { describe, expect, it } from 'vitest'
import { pickMacZipAsset, type ReleaseAsset } from './github-release'

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

  it('ignores non-zip assets and wrong arch', () => {
    expect(pickMacZipAsset([asset('Yardarm-0.1.1-arm64.dmg')], 'arm64')).toBeNull()
    expect(pickMacZipAsset([asset('Yardarm-0.1.1-x64.zip')], 'arm64')).toBeNull()
    expect(pickMacZipAsset([], 'arm64')).toBeNull()
  })
})
