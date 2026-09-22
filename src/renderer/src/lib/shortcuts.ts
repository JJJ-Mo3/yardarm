/**
 * App-wide keyboard shortcuts, registered once from App. Uses atoms so any
 * surface (sidebar dialog, threads popover, tabs, settings) can be driven
 * from the keyboard. Cmd on macOS, Ctrl elsewhere.
 *
 *   Cmd+N     new chat
 *   Cmd+K     command palette
 *   Cmd+P     thread switcher
 *   Cmd+J     toggle terminal tab
 *   Cmd+1–9   main tabs in visual order (chat / CLI / IDE / changes / terminal / kanban / analytics / preview / guide)
 *   Cmd+,     settings
 */
import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import {
  commandPaletteOpenAtom,
  mainTabAtom,
  newChatOpenAtom,
  settingsOpenAtom,
  threadsOpenAtom,
  type MainTab
} from './atoms'

// Must match the visual TABS order in App.tsx.
const TAB_ORDER: MainTab[] = [
  'chat',
  'cli',
  'files',
  'changes',
  'terminal',
  'kanban',
  'analytics',
  'preview',
  'guide'
]

export function useAppShortcuts(): void {
  const setTab = useSetAtom(mainTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setNewChatOpen = useSetAtom(newChatOpenAtom)
  const setThreadsOpen = useSetAtom(threadsOpenAtom)
  const setPaletteOpen = useSetAtom(commandPaletteOpenAtom)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey || e.shiftKey) return
      switch (e.key) {
        case 'n':
          e.preventDefault()
          setNewChatOpen(true)
          break
        case 'k':
          // Skip when a focused surface (e.g. Monaco) already claimed the key.
          if (e.defaultPrevented) break
          e.preventDefault()
          setPaletteOpen(true)
          break
        case 'p':
          e.preventDefault()
          setThreadsOpen(true)
          break
        case 'j':
          e.preventDefault()
          setTab((t) => (t === 'terminal' ? 'chat' : 'terminal'))
          break
        case ',':
          e.preventDefault()
          setSettingsOpen(true)
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          e.preventDefault()
          setTab(TAB_ORDER[Number(e.key) - 1])
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setTab, setSettingsOpen, setNewChatOpen, setThreadsOpen, setPaletteOpen])
}
