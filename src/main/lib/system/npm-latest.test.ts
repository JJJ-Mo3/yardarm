import { describe, expect, it } from 'vitest'
import { parseNpmLatest } from './npm-latest'

describe('parseNpmLatest', () => {
  it('returns the version from a valid registry document', () => {
    expect(parseNpmLatest({ name: 'mastracode', version: '0.32.1' })).toBe('0.32.1')
  })

  it('returns null when version is missing', () => {
    expect(parseNpmLatest({ name: 'mastracode' })).toBeNull()
  })

  it('returns null when version is not a string', () => {
    expect(parseNpmLatest({ version: 42 })).toBeNull()
    expect(parseNpmLatest({ version: '' })).toBeNull()
  })

  it('returns null for non-object inputs', () => {
    expect(parseNpmLatest(null)).toBeNull()
    expect(parseNpmLatest(undefined)).toBeNull()
    expect(parseNpmLatest('0.32.1')).toBeNull()
    expect(parseNpmLatest([])).toBeNull()
  })
})
