/** Tests for the pure editor-tab reducers behind the IDE tab. */
import { describe, expect, it } from 'vitest'
import {
  applyDiskUpdate,
  closeTab,
  emptyTabsState,
  openTab,
  setDirty,
  type EditorTab,
  type TabsState
} from './editor-tabs'

function tab(path: string, dirty = false): EditorTab {
  return { path, kind: 'text', savedContent: `content of ${path}`, mtimeMs: 1, dirty }
}

function stateWith(...paths: string[]): TabsState {
  return paths.reduce((s, p) => openTab(s, tab(p)), emptyTabsState)
}

describe('editor-tabs reducers', () => {
  it('openTab appends and activates; reopening only activates without duplicating', () => {
    let s = stateWith('a.ts', 'b.ts')
    expect(s.tabs.map((t) => t.path)).toEqual(['a.ts', 'b.ts'])
    expect(s.activePath).toBe('b.ts')
    s = openTab(s, tab('a.ts'))
    expect(s.tabs).toHaveLength(2)
    expect(s.activePath).toBe('a.ts')
  })

  it('closeTab activates the next tab, else the previous, else null', () => {
    let s = stateWith('a.ts', 'b.ts', 'c.ts')
    s = { ...s, activePath: 'b.ts' }
    s = closeTab(s, 'b.ts')
    expect(s.activePath).toBe('c.ts') // next
    s = closeTab(s, 'c.ts')
    expect(s.activePath).toBe('a.ts') // previous (was last)
    s = closeTab(s, 'a.ts')
    expect(s.activePath).toBeNull()
    expect(closeTab(s, 'missing.ts')).toBe(s) // no-op returns same object
  })

  it('setDirty returns the same object when unchanged', () => {
    const s = stateWith('a.ts')
    expect(setDirty(s, 'a.ts', false)).toBe(s)
    const dirty = setDirty(s, 'a.ts', true)
    expect(dirty).not.toBe(s)
    expect(dirty.tabs[0].dirty).toBe(true)
  })

  it('applyDiskUpdate updates clean tabs, skips dirty tabs, and force overrides', () => {
    const clean = stateWith('a.ts')
    const updated = applyDiskUpdate(clean, 'a.ts', 'fresh', 2)
    expect(updated.tabs[0]).toMatchObject({ savedContent: 'fresh', mtimeMs: 2, dirty: false })
    expect(applyDiskUpdate(updated, 'a.ts', 'fresh', 2)).toBe(updated) // no-op

    const dirty = setDirty(clean, 'a.ts', true)
    expect(applyDiskUpdate(dirty, 'a.ts', 'fresh', 2)).toBe(dirty) // never clobber edits

    const forced = applyDiskUpdate(dirty, 'a.ts', 'fresh', 2, true)
    expect(forced.tabs[0]).toMatchObject({ savedContent: 'fresh', mtimeMs: 2, dirty: false })
  })
})
