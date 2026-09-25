/**
 * Tab strip over TerminalView for the Terminal tab: the default chat/project
 * shell plus extra sessions opened in other locations (this chat's worktree
 * again, the project root, or another chat's worktree). Ptys live in the main
 * process, so switching tabs reattaches via scrollback replay; closing a tab
 * kills its pty. Extra sessions are tracked per project in extraTerminalsAtom.
 */
import React, { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { Plus, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { activeTerminalIdAtom, extraTerminalsAtom, type ExtraTerminal } from '../../lib/atoms'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Tip } from '../../components/ui/tooltip'
import { TerminalView } from './TerminalView'

export function TerminalTabs({
  projectId,
  projectPath,
  chatId,
  chatWorktreePath,
  cwd
}: {
  projectId: string
  projectPath: string | null
  chatId: string | null
  chatWorktreePath: string | null
  /** Where the default session runs: the chat worktree, else the project root. */
  cwd: string
}): React.JSX.Element {
  const [extraMap, setExtraMap] = useAtom(extraTerminalsAtom)
  const [activeId, setActiveId] = useAtom(activeTerminalIdAtom)
  const [pickerOpen, setPickerOpen] = useState(false)
  const kill = trpc.terminal.kill.useMutation()
  const chats = trpc.chats.list.useQuery({ projectId }, { enabled: pickerOpen })

  const defaultId = chatId ? `chat-${chatId}` : `project-${projectId}`
  const extras = extraMap[projectId] ?? []
  const active = extras.find((t) => t.id === activeId) ?? null // null = default tab

  // Chat/project switches change the default session — show it, not a stale
  // extra tab from before the switch.
  useEffect(() => {
    setActiveId(null)
  }, [defaultId, setActiveId])

  function addSession(sessionCwd: string, label: string): void {
    const t: ExtraTerminal = { id: `term-${crypto.randomUUID()}`, cwd: sessionCwd, label }
    setExtraMap({ ...extraMap, [projectId]: [...extras, t] })
    setActiveId(t.id)
    setPickerOpen(false)
  }

  function closeSession(id: string): void {
    kill.mutate({ id })
    setExtraMap({ ...extraMap, [projectId]: extras.filter((t) => t.id !== id) })
    if (activeId === id) setActiveId(null)
  }

  // Locations offered by the "+" picker. The current chat's worktree is
  // included so a second independent shell can run alongside the default one.
  const locations: Array<{ key: string; label: string; cwd: string }> = []
  if (chatWorktreePath)
    locations.push({ key: 'chat', label: 'This chat’s worktree', cwd: chatWorktreePath })
  if (projectPath) locations.push({ key: 'project', label: 'Project root', cwd: projectPath })
  for (const c of chats.data ?? []) {
    if (c.archived || !c.worktreePath || c.id === chatId) continue
    locations.push({ key: c.id, label: c.title, cwd: c.worktreePath })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1">
        <Tip
          content={
            chatId
              ? 'The default terminal for this chat — runs in its worktree'
              : 'The default terminal for this project — runs at the project root'
          }
          side="bottom"
        >
          <button
            onClick={() => setActiveId(null)}
            className={cn(
              'rounded px-2 py-0.5 text-[11px] cursor-pointer',
              !active ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {chatId ? 'This chat' : 'Project'}
          </button>
        </Tip>
        {extras.map((t) => (
          <div
            key={t.id}
            className={cn('flex items-center rounded', active?.id === t.id && 'bg-accent')}
          >
            <Tip content={`Switch to this terminal session — runs in ${t.cwd}`} side="bottom">
              <button
                onClick={() => setActiveId(t.id)}
                className={cn(
                  'max-w-48 truncate px-2 py-0.5 text-[11px] cursor-pointer',
                  active?.id === t.id
                    ? 'font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
              </button>
            </Tip>
            <Tip content="Close this terminal session (ends its shell)" side="bottom">
              <button
                onClick={() => closeSession(t.id)}
                className="pr-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X size={11} />
              </button>
            </Tip>
          </div>
        ))}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <Tip
            content="Open a terminal session in another location — the project root or another chat’s worktree"
            side="bottom"
          >
            <PopoverTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:text-foreground cursor-pointer">
                <Plus size={13} />
              </button>
            </PopoverTrigger>
          </Tip>
          <PopoverContent align="start" className="w-80 p-1">
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              New terminal session in…
            </div>
            {locations.map((l) => (
              <button
                key={l.key}
                onClick={() => addSession(l.cwd, l.label)}
                className="flex w-full flex-col items-start rounded px-2 py-1 text-left hover:bg-accent cursor-pointer"
              >
                <span className="max-w-full truncate text-xs">{l.label}</span>
                <span
                  className="max-w-full truncate text-[10px] text-muted-foreground"
                  title={l.cwd}
                >
                  {l.cwd}
                </span>
              </button>
            ))}
            {locations.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                No other locations available
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <div className="min-h-0 flex-1">
        {active ? (
          <TerminalView key={active.id} id={active.id} cwd={active.cwd} />
        ) : (
          <TerminalView key={defaultId} id={defaultId} cwd={cwd} />
        )}
      </div>
    </div>
  )
}
