import { describe, expect, it } from 'vitest'
import { computeDesiredConfig, configsEqual, makeProfilePath } from './sandbox-isolation'

describe('computeDesiredConfig', () => {
  it('includes the working directory and allowed paths, deduped and sorted', () => {
    const cfg = computeDesiredConfig(true, true, '/work/tree', [
      '/extra/b',
      '/extra/a',
      '/extra/b',
      '/work/tree'
    ])
    expect(cfg.readWritePaths).toEqual(['/extra/a', '/extra/b', '/work/tree'])
  })

  it('drops relative and non-string entries', () => {
    const cfg = computeDesiredConfig(true, false, '/work/tree', [
      'relative/path',
      '',
      '/ok',
      undefined as unknown as string
    ])
    expect(cfg.readWritePaths).toEqual(['/ok', '/work/tree'])
  })

  it('normalizes redundant path segments', () => {
    const cfg = computeDesiredConfig(true, true, '/work/tree', ['/extra//a/../a'])
    expect(cfg.readWritePaths).toEqual(['/extra/a', '/work/tree'])
  })

  it('carries the enabled and network flags through', () => {
    expect(computeDesiredConfig(true, false, '/w', [])).toMatchObject({
      enabled: true,
      allowNetwork: false
    })
    expect(computeDesiredConfig(false, true, '/w', [])).toMatchObject({
      enabled: false,
      allowNetwork: true
    })
  })
})

describe('configsEqual', () => {
  const base = computeDesiredConfig(true, true, '/w', ['/a', '/b'])

  it('is false against null (first application always proceeds)', () => {
    expect(configsEqual(null, base)).toBe(false)
  })

  it('is true for identical configs regardless of input order', () => {
    expect(configsEqual(base, computeDesiredConfig(true, true, '/w', ['/b', '/a']))).toBe(true)
  })

  it('detects flag drift', () => {
    expect(configsEqual(base, computeDesiredConfig(false, true, '/w', ['/a', '/b']))).toBe(false)
    expect(configsEqual(base, computeDesiredConfig(true, false, '/w', ['/a', '/b']))).toBe(false)
  })

  it('detects added and removed paths', () => {
    expect(configsEqual(base, computeDesiredConfig(true, true, '/w', ['/a', '/b', '/c']))).toBe(
      false
    )
    expect(configsEqual(base, computeDesiredConfig(true, true, '/w', ['/a']))).toBe(false)
  })
})

describe('makeProfilePath', () => {
  it('creates .sb files under the given directory', () => {
    const p = makeProfilePath('/tmp/dir')
    expect(p.startsWith('/tmp/dir/')).toBe(true)
    expect(p.endsWith('.sb')).toBe(true)
  })

  it('never returns the same path twice (stale-profile guard)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) seen.add(makeProfilePath('/tmp/dir'))
    expect(seen.size).toBe(50)
  })
})
