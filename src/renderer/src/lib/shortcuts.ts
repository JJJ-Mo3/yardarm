/**
 * App-wide keyboard shortcuts, registered once from App. Uses atoms so any
 * surface (sidebar dialog, threads popover, tabs, settings) can be driven
 * from the keyboard. Cmd on macOS, Ctrl elsewhere.
 *
 *   Cmd+N     new chat
 *   Cmd+P     thread switcher
 *   Cmd+J     toggle terminal tab
 *   Cmd+1–4   main tabs (chat / changes / terminal / files)
 *   Cmd+,     settings
 */
import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import {
  mainTabAtom,
  newChatOpenAtom,
  settingsOpenAtom,
  threadsOpenAtom,
  type MainTab
} from './atoms'

const TAB_ORDER: MainTab[] = ['chat', 'changes', 'terminal', 'files']

export function useAppShortcuts(): void {
  const setTab = useSetAtom(mainTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setNewChatOpen = useSetAtom(newChatOpenAtom)
  const setThreadsOpen = useSetAtom(threadsOpenAtom)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey || e.shiftKey) return
      switch (e.key) {
        case 'n':
          e.preventDefault()
          setNewChatOpen(true)
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
          e.preventDefault()
          setTab(TAB_ORDER[Number(e.key) - 1])
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setTab, setSettingsOpen, setNewChatOpen, setThreadsOpen])
}
