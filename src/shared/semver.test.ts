import { describe, expect, it } from 'vitest'
import { isNewerVersion, parseVersion } from './semver'

describe('parseVersion', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: null })
    expect(parseVersion('v2.10.3')).toEqual({ major: 2, minor: 10, patch: 3, prerelease: null })
    expect(parseVersion(' v1.0.0 ')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: null })
  })

  it('parses prerelease suffixes', () => {
    expect(parseVersion('1.2.3-beta.1')?.prerelease).toBe('beta.1')
  })

  it('rejects garbage', () => {
    for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'v', '1.2.x', '1.2.3+meta!']) {
      expect(parseVersion(bad)).toBeNull()
    }
  })
})

describe('isNewerVersion', () => {
  it('detects newer major/minor/patch', () => {
    expect(isNewerVersion('0.1.0', '0.1.1')).toBe(true)
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(true)
    expect(isNewerVersion('0.1.0', 'v0.2.0')).toBe(true)
  })

  it('is false for equal or older versions', () => {
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
  })

  it('numeric compare, not lexicographic', () => {
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(false)
  })

  it('prerelease of the same triple is not newer; the release over a prerelease is', () => {
    expect(isNewerVersion('0.1.0', '0.1.0-beta.1')).toBe(false)
    expect(isNewerVersion('0.1.0-beta.1', '0.1.0')).toBe(true)
  })

  it('fails closed on unparseable input', () => {
    expect(isNewerVersion('0.1.0', 'latest')).toBe(false)
    expect(isNewerVersion('dev', '9.9.9')).toBe(false)
  })
})
