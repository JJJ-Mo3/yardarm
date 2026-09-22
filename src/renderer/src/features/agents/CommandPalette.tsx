/**
 * Global Cmd+K command palette: run slash commands on the active chat, jump
 * to main tabs, open settings sections, and switch chats. Slash commands go
 * through the bridge the primary ChatView registers (paletteDispatchAtom);
 * arg-taking commands prefill the composer instead of executing.
 */
import React, { useMemo } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  BookOpen,
  ChartColumn,
  FileCode2,
  GitCompare,
  Globe,
  MessageSquare,
  MessagesSquare,
  Settings2,
  SquareChevronRight,
  SquareKanban,
  SquareSlash,
  TerminalSquare
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import {
  commandPaletteOpenAtom,
  mainTabAtom,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom,
  settingsOpenAtom,
  settingsTabAtom,
  type MainTab,
  type SettingsTab
} from '../../lib/atoms'
import { useSelectChat } from '../../lib/use-select-chat'
import { CommandDialog, type CommandAction } from '../../components/ui/command'
import { paletteDispatchAtom, useSlashCommands } from './slash-commands'

/** Must match the visual TABS order in App.tsx (⌘1–9 hints). */
const TABS: Array<{ id: MainTab; label: string; icon: React.ReactNode }> = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare size={13} /> },
  { id: 'cli', label: 'CLI', icon: <SquareChevronRight size={13} /> },
  { id: 'files', label: 'IDE', icon: <FileCode2 size={13} /> },
  { id: 'changes', label: 'Changes', icon: <GitCompare size={13} /> },
  { id: 'terminal', label: 'Terminal', icon: <TerminalSquare size={13} /> },
  { id: 'kanban', label: 'Kanban', icon: <SquareKanban size={13} /> },
  { id: 'analytics', label: 'Analytics', icon: <ChartColumn size={13} /> },
  { id: 'preview', label: 'Preview', icon: <Globe size={13} /> },
  { id: 'guide', label: 'Guide', icon: <BookOpen size={13} /> }
]

const SETTINGS_SECTIONS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'keys', label: 'API Keys' },
  { id: 'models', label: 'Models' },
  { id: 'providers', label: 'Providers' },
  { id: 'voice', label: 'Voice' },
  { id: 'browser', label: 'Browser' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'agents', label: 'Subagents' },
  { id: 'languages', label: 'Languages' },
  { id: 'about', label: 'About' }
]

export function CommandPalette(): React.JSX.Element {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom)
  const dispatch = useAtomValue(paletteDispatchAtom)
  const subchatId = useAtomValue(selectedSubchatIdAtom)
  const chatId = useAtomValue(selectedChatIdAtom)
  const projectId = useAtomValue(selectedProjectIdAtom)
  const setTab = useSetAtom(mainTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const selectChat = useSelectChat()
  const commands = useSlashCommands(open ? subchatId : null)
  const chats = trpc.chats.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: open && !!projectId }
  )

  const actions = useMemo(() => {
    const list: CommandAction[] = []
    if (dispatch && subchatId) {
      for (const c of commands) {
        if (c.kind === 'cli-only') continue
        list.push({
          id: `cmd:${c.name}`,
          group: 'Commands',
          label: `/${c.name}`,
          icon: <SquareSlash size={13} />,
          detail: c.args ? `${c.args} — ${c.description}` : c.description,
          keywords: c.description,
          onSelect: () => {
            setTab('chat')
            // Arg-taking commands can't run without input — hand them to the
            // composer instead so the user fills in the arguments.
            if (c.args) dispatch.prefill(`/${c.name} `)
            else dispatch.run(c, '')
          }
        })
      }
    }
    TABS.forEach((t, i) => {
      list.push({
        id: `tab:${t.id}`,
        group: 'Go to',
        label: t.label,
        icon: t.icon,
        detail: `⌘${i + 1}`,
        onSelect: () => setTab(t.id)
      })
    })
    for (const s of SETTINGS_SECTIONS) {
      list.push({
        id: `settings:${s.id}`,
        group: 'Settings',
        label: `Settings → ${s.label}`,
        icon: <Settings2 size={13} />,
        onSelect: () => {
          setSettingsTab(s.id)
          setSettingsOpen(true)
        }
      })
    }
    for (const c of (chats.data ?? []).filter((c) => !c.archived && c.id !== chatId)) {
      list.push({
        id: `chat:${c.id}`,
        group: 'Switch chat',
        label: c.title,
        icon: <MessagesSquare size={13} />,
        detail: c.branch ?? undefined,
        onSelect: () => {
          selectChat(c.id)
          setTab('chat')
        }
      })
    }
    return list
  }, [
    dispatch,
    subchatId,
    commands,
    chats.data,
    chatId,
    setTab,
    setSettingsTab,
    setSettingsOpen,
    selectChat
  ])

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      actions={actions}
      placeholder="Type a command or search…"
    />
  )
}
