/** Tests for the IDE-edit tracker that informs the agent about user file edits. */
import { describe, expect, it } from 'vitest'
import { IdeEditTracker, formatIdeEditNote } from './ide-edit-notes'

describe('IdeEditTracker', () => {
  it('dedupes repeated paths and fans out to multiple subchats', () => {
    const t = new IdeEditTracker()
    t.add(['a', 'b'], 'src/x.ts')
    t.add(['a', 'b'], 'src/x.ts')
    t.add(['a'], 'src/y.ts')
    expect(t.drain('a')).toEqual(['src/x.ts', 'src/y.ts'])
    expect(t.drain('b')).toEqual(['src/x.ts'])
  })

  it('drain returns sorted paths, clears the set, and handles unknown subchats', () => {
    const t = new IdeEditTracker()
    t.add(['a'], 'zeta.ts')
    t.add(['a'], 'alpha.ts')
    expect(t.drain('a')).toEqual(['alpha.ts', 'zeta.ts'])
    expect(t.drain('a')).toEqual([])
    expect(t.drain('never-seen')).toEqual([])
    t.add(['b'], 'x.ts')
    t.clear('b')
    expect(t.drain('b')).toEqual([])
  })

  it('hasPending reflects adds, drains, and clears', () => {
    const t = new IdeEditTracker()
    expect(t.hasPending('a')).toBe(false)
    t.add(['a'], 'src/x.ts')
    expect(t.hasPending('a')).toBe(true)
    t.drain('a')
    expect(t.hasPending('a')).toBe(false)
    t.add(['b'], 'y.ts')
    t.clear('b')
    expect(t.hasPending('b')).toBe(false)
  })

  it('supports re-adding drained paths (failed mid-run delivery fallback)', () => {
    const t = new IdeEditTracker()
    t.add(['a'], 'src/x.ts')
    t.add(['a'], 'src/y.ts')
    const drained = t.drain('a')
    expect(drained).toEqual(['src/x.ts', 'src/y.ts'])
    for (const p of drained) t.add(['a'], p)
    expect(t.drain('a')).toEqual(['src/x.ts', 'src/y.ts'])
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
