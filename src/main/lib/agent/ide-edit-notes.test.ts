/** Tests for the IDE-edit note helpers that inform the agent about user file edits. */
import { describe, expect, it } from 'vitest'
import { addIdeEditPath, parseIdeEditPaths, formatIdeEditNote } from './ide-edit-notes'

describe('addIdeEditPath', () => {
  it('starts a new array from null and dedupes repeated paths', () => {
    const once = addIdeEditPath(null, 'src/x.ts')
    expect(parseIdeEditPaths(once)).toEqual(['src/x.ts'])
    const twice = addIdeEditPath(once, 'src/x.ts')
    expect(parseIdeEditPaths(twice)).toEqual(['src/x.ts'])
    const more = addIdeEditPath(twice, 'src/y.ts')
    expect(parseIdeEditPaths(more)).toEqual(['src/x.ts', 'src/y.ts'])
  })

  it('recovers from garbage column values', () => {
    expect(parseIdeEditPaths(addIdeEditPath('not json', 'a.ts'))).toEqual(['a.ts'])
    expect(parseIdeEditPaths(addIdeEditPath('{"nope":1}', 'a.ts'))).toEqual(['a.ts'])
  })

  it('supports re-adding drained paths (failed mid-run delivery fallback)', () => {
    let json: string | null = null
    json = addIdeEditPath(json, 'src/x.ts')
    json = addIdeEditPath(json, 'src/y.ts')
    const drained = parseIdeEditPaths(json)
    expect(drained).toEqual(['src/x.ts', 'src/y.ts'])
    let requeued: string | null = null
    for (const p of drained) requeued = addIdeEditPath(requeued, p)
    expect(parseIdeEditPaths(requeued)).toEqual(['src/x.ts', 'src/y.ts'])
  })
})

describe('parseIdeEditPaths', () => {
  it('returns sorted paths and [] for null, garbage, and non-arrays', () => {
    expect(parseIdeEditPaths('["zeta.ts","alpha.ts"]')).toEqual(['alpha.ts', 'zeta.ts'])
    expect(parseIdeEditPaths(null)).toEqual([])
    expect(parseIdeEditPaths('')).toEqual([])
    expect(parseIdeEditPaths('not json')).toEqual([])
    expect(parseIdeEditPaths('42')).toEqual([])
    expect(parseIdeEditPaths('{"a":1}')).toEqual([])
  })

  it('drops non-string entries', () => {
    expect(parseIdeEditPaths('["a.ts", 3, null, "b.ts"]')).toEqual(['a.ts', 'b.ts'])
  })
})

describe('formatIdeEditNote', () => {
  it('is empty for no paths and lists backticked paths with a re-read instruction', () => {
    expect(formatIdeEditNote([])).toBe('')
    const note = formatIdeEditNote(['src/a.ts', 'docs/b.md'])
    expect(note).toContain('`src/a.ts`, `docs/b.md`')
    expect(note).toContain('Yardarm IDE')
    expect(note).toContain('re-read')
    // The same wording is used mid-run and as a next-prompt suffix, so it
    // must not anchor itself to "your last message".
    expect(note).not.toContain('since your last message')
  })
})
