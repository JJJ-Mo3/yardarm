/**
 * App-wide keyboard shortcuts, registered once from App. Uses atoms so any
 * surface (sidebar dialog, threads popover, tabs, settings) can be driven
 * from the keyboard. Cmd on macOS, Ctrl elsewhere.
 *
 * Bindings are customizable in Settings → Keyboard: the action catalog and
 * combo matching live in shortcut-registry.ts, user overrides are persisted
 * in app_settings 'keyboardShortcuts' and mirrored into shortcutOverridesAtom
 * by useShortcutOverridesSync. ⌘1–8 main-tab switching is fixed. The 'find'
 * action is matched by its owners (ChatView / TerminalView), not here.
 */
import { useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { trpc } from './trpc'
import {
  commandPaletteOpenAtom,
  mainTabAtom,
  MAX_SPLIT_PANES,
  newChatOpenAtom,
  quickOpenAtom,
  settingsOpenAtom,
  shortcutOverridesAtom,
  splitPanesAtom,
  threadsOpenAtom,
  type MainTab
} from './atoms'
import {
  eventToCombo,
  resolveCombo,
  SHORTCUT_DEFS,
  type ShortcutActionId,
  type ShortcutOverrides
} from './shortcut-registry'

/** True in macOS renderers; drives shortcut display labels (⌘ vs Ctrl+). */
export const isMac = navigator.platform.toUpperCase().includes('MAC')

/** Platform display label for a mod-key shortcut: modLabel('K') → "⌘K" / "Ctrl+K". */
export function modLabel(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`
}

// Must match the visual TABS order in App.tsx. The Factory tab is
// deliberately unnumbered (tab bar / ⌘K only).
const TAB_ORDER: MainTab[] = [
  'chat',
  'cli',
  'files',
  'changes',
  'terminal',
  'analytics',
  'preview',
  'guide'
]

/** Load persisted shortcut overrides into the atom once at app start. */
export function useShortcutOverridesSync(): void {
  const setOverrides = useSetAtom(shortcutOverridesAtom)
  const stored = trpc.settings.get.useQuery({ key: 'keyboardShortcuts' })
  useEffect(() => {
    if (stored.data && typeof stored.data === 'object') {
      setOverrides(stored.data as ShortcutOverrides)
    }
  }, [stored.data, setOverrides])
}

export function useAppShortcuts(): void {
  const setTab = useSetAtom(mainTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setNewChatOpen = useSetAtom(newChatOpenAtom)
  const setThreadsOpen = useSetAtom(threadsOpenAtom)
  const setPaletteOpen = useSetAtom(commandPaletteOpenAtom)
  const setQuickOpen = useSetAtom(quickOpenAtom)
  const setSplitPanes = useSetAtom(splitPanesAtom)
  const overrides = useAtomValue(shortcutOverridesAtom)

  // Effective combo → action map ('find' is dispatched by its owning views).
  const comboMap = useMemo(() => {
    const map = new Map<string, ShortcutActionId>()
    for (const def of SHORTCUT_DEFS) {
      if (def.id === 'find') continue
      map.set(resolveCombo(def.id, overrides), def.id)
    }
    return map
  }, [overrides])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return
      // Fixed tab switching first — not rebindable.
      if (!e.shiftKey && e.key >= '1' && e.key <= '8') {
        e.preventDefault()
        setTab(TAB_ORDER[Number(e.key) - 1])
        return
      }
      const combo = eventToCombo(e)
      const action = combo ? comboMap.get(combo) : undefined
      if (!action) return
      switch (action) {
        case 'newChat':
          e.preventDefault()
          setNewChatOpen(true)
          break
        case 'commandPalette':
          // Skip when a focused surface (e.g. Monaco) already claimed the key.
          if (e.defaultPrevented) break
          e.preventDefault()
          setPaletteOpen(true)
          break
        case 'quickOpen':
          e.preventDefault()
          setQuickOpen(true)
          break
        case 'threadSwitcher':
          e.preventDefault()
          setThreadsOpen(true)
          break
        case 'toggleTerminal':
          e.preventDefault()
          setTab((t) => (t === 'terminal' ? 'chat' : 'terminal'))
          break
        case 'settings':
          e.preventDefault()
          setSettingsOpen(true)
          break
        case 'splitAdd':
          e.preventDefault()
          setSplitPanes((panes) =>
            panes.length >= MAX_SPLIT_PANES
              ? panes
              : [...panes, { key: crypto.randomUUID(), chatId: null, subchatId: null }]
          )
          setTab('chat')
          break
        case 'splitClose':
          e.preventDefault()
          setSplitPanes((panes) => panes.slice(0, -1))
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    comboMap,
    setTab,
    setSettingsOpen,
    setNewChatOpen,
    setThreadsOpen,
    setPaletteOpen,
    setQuickOpen,
    setSplitPanes
  ])
}
