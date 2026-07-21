import { describe, expect, it } from 'vitest'
import { parseNameStatus } from './ops'

describe('parseNameStatus', () => {
  it('parses modified, added, and deleted entries', () => {
    expect(parseNameStatus('M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts\n')).toEqual([
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/b.ts', status: 'A' },
      { path: 'src/c.ts', status: 'D' }
    ])
  })

  it('reports renames under the new path with status R', () => {
    expect(parseNameStatus('R100\told/name.ts\tnew/name.ts\n')).toEqual([
      { path: 'new/name.ts', status: 'R' }
    ])
  })

  it('filters blank lines and tolerates missing trailing newline', () => {
    expect(parseNameStatus('\nM\ta.ts\n\nA\tb.ts')).toEqual([
      { path: 'a.ts', status: 'M' },
      { path: 'b.ts', status: 'A' }
    ])
  })

  it('returns empty for empty output', () => {
    expect(parseNameStatus('')).toEqual([])
    expect(parseNameStatus('\n')).toEqual([])
  })
})
