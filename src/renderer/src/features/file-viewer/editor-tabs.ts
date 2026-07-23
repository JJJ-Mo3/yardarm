/**
 * Editor-tab state for the IDE tab: which files are open per worktree/project
 * root, which is active, and each buffer's saved-on-disk baseline. Pure
 * reducers (no React/Electron imports) so they're unit-testable; every
 * reducer returns the same object when nothing changes to avoid render
 * thrash. The atom is keyed by root so tabs survive chat switches, and the
 * IDE view stays mounted so dirty Monaco buffers survive main-tab switches.
 */
import { atom } from 'jotai'

export type TabKind = 'text' | 'binary' | 'tooLarge'

export interface EditorTab {
  path: string // relative to root
  kind: TabKind
  savedContent: string // disk content at last load/save ('' for non-text)
  mtimeMs: number
  dirty: boolean
}

export interface TabsState {
  tabs: EditorTab[]
  activePath: string | null
}

export const emptyTabsState: TabsState = { tabs: [], activePath: null }

/** Open tabs per worktree/project root. */
export const editorTabsAtom = atom<Record<string, TabsState>>({})

/** Add a tab (if not already open) and activate it. */
export function openTab(s: TabsState, tab: EditorTab): TabsState {
  const existing = s.tabs.find((t) => t.path === tab.path)
  if (existing) return activateTab(s, tab.path)
  return { tabs: [...s.tabs, tab], activePath: tab.path }
}

/** Remove a tab; when it was active, activate the next tab, else the previous. */
export function closeTab(s: TabsState, path: string): TabsState {
  const idx = s.tabs.findIndex((t) => t.path === path)
  if (idx === -1) return s
  const tabs = s.tabs.filter((t) => t.path !== path)
  let activePath = s.activePath
  if (s.activePath === path) {
    activePath = tabs[idx]?.path ?? tabs[idx - 1]?.path ?? null
  }
  return { tabs, activePath }
}

export function activateTab(s: TabsState, path: string): TabsState {
  if (s.activePath === path) return s
  if (!s.tabs.some((t) => t.path === path)) return s
  return { ...s, activePath: path }
}

export function setDirty(s: TabsState, path: string, dirty: boolean): TabsState {
  const tab = s.tabs.find((t) => t.path === path)
  if (!tab || tab.dirty === dirty) return s
  return { ...s, tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty } : t)) }
}

/** Record a successful save: new disk baseline, buffer clean. */
export function markSaved(s: TabsState, path: string, content: string, mtimeMs: number): TabsState {
  const tab = s.tabs.find((t) => t.path === path)
  if (!tab) return s
  return {
    ...s,
    tabs: s.tabs.map((t) =>
      t.path === path ? { ...t, savedContent: content, mtimeMs, dirty: false } : t
    )
  }
}

/**
 * Adopt fresh disk content (external change, e.g. by the agent). No-op for a
 * dirty tab — an external refresh must never clobber the user's edits —
 * unless `force` is set (the explicit reload-from-disk flow).
 */
export function applyDiskUpdate(
  s: TabsState,
  path: string,
  content: string,
  mtimeMs: number,
  force = false
): TabsState {
  const tab = s.tabs.find((t) => t.path === path)
  if (!tab) return s
  if (tab.dirty && !force) return s
  if (tab.savedContent === content && tab.mtimeMs === mtimeMs && !tab.dirty) return s
  return {
    ...s,
    tabs: s.tabs.map((t) =>
      t.path === path ? { ...t, savedContent: content, mtimeMs, dirty: false } : t
    )
  }
}
