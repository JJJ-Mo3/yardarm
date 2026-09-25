import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('ranks basename prefix best, then basename substring, path substring, subsequence', () => {
    expect(fuzzyScore('src/lib/atoms.ts', 'atoms')).toBe(0)
    expect(fuzzyScore('src/lib/all-atoms.ts', 'atoms')).toBe(1)
    expect(fuzzyScore('atoms/index.ts', 'atoms')).toBe(2)
    expect(fuzzyScore('a/toms.ts', 'atoms')).toBe(3)
    expect(fuzzyScore('src/other.ts', 'atoms')).toBe(-1)
  })

  it('matches case-insensitively and treats an empty query as a match', () => {
    expect(fuzzyScore('src/App.tsx', 'app')).toBe(0)
    expect(fuzzyScore('anything', '')).toBe(0)
  })
})

describe('fuzzyFilter', () => {
  const paths = [
    'src/renderer/src/lib/all-atoms.ts',
    'src/renderer/src/lib/atoms.ts',
    'atoms/index.ts',
    'a/toms.ts',
    'README.md'
  ]

  it('sorts by tier then shorter path, dropping non-matches', () => {
    expect(fuzzyFilter(paths, 'atoms', 10)).toEqual([
      'src/renderer/src/lib/atoms.ts',
      'src/renderer/src/lib/all-atoms.ts',
      'atoms/index.ts',
      'a/toms.ts'
    ])
  })

  it('caps results at the limit and passes through on empty query', () => {
    expect(fuzzyFilter(paths, 'atoms', 2)).toEqual([
      'src/renderer/src/lib/atoms.ts',
      'src/renderer/src/lib/all-atoms.ts'
    ])
    expect(fuzzyFilter(paths, '  ', 3)).toEqual(paths.slice(0, 3))
  })
})
