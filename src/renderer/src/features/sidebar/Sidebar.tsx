import React, { useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  FolderCog,
  FolderGit2,
  Loader2,
  MessageSquarePlus,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import {
  addProjectOpenAtom,
  chatStatusesAtom,
  newChatOpenAtom,
  projectSettingsOpenAtom,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom,
  settingsOpenAtom,
  themeAtom,
  unseenChatsAtom
} from '../../lib/atoms'
import { useIsDark } from '../../lib/use-dark'
import { useSelectChat } from '../../lib/use-select-chat'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { AddProjectDialog } from './AddProjectDialog'
import { Logo } from '../../components/Logo'

/**
 * Per-chat activity badge: amber dot = awaiting a user response, spinner =
 * agent working, blue dot = run finished but not yet viewed. Hidden on row
 * hover so the rename/delete buttons can take its slot without a width jump.
 */
function ChatStatusIndicator({
  running,
  awaiting,
  unseen
}: {
  running: boolean
  awaiting: boolean
  unseen: boolean
}): React.JSX.Element | null {
  if (awaiting) {
    return (
      <Tip content="The agent is waiting for your response">
        <span className="block group-hover:hidden h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      </Tip>
    )
  }
  if (running) {
    return (
      <Tip content="The agent is working in this chat">
        <span className="block group-hover:hidden shrink-0 text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
        </span>
      </Tip>
    )
  }
  if (unseen) {
    return (
      <Tip content="The agent finished — you haven't viewed the result yet">
        <span className="block group-hover:hidden h-2 w-2 shrink-0 rounded-full bg-blue-500" />
      </Tip>
    )
  }
  return null
}

export function Sidebar(): React.JSX.Element {
  const [projectId, setProjectId] = useAtom(selectedProjectIdAtom)
  const [chatId, setChatId] = useAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setTheme = useSetAtom(themeAtom)
  const isDark = useIsDark()
  const setProjectSettingsOpen = useSetAtom(projectSettingsOpenAtom)
  const [newChatOpen, setNewChatOpen] = useAtom(newChatOpenAtom)
  const setAddProjectOpen = useSetAtom(addProjectOpenAtom)
  const [newChatTitle, setNewChatTitle] = useState('')
  const [useWorktree, setUseWorktree] = useState(true)
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const chatStatuses = useAtomValue(chatStatusesAtom)
  const unseenChats = useAtomValue(unseenChatsAtom)
  const confirmDialog = useConfirm()

  const utils = trpc.useUtils()
  const projects = trpc.projects.list.useQuery()
  const chats = trpc.chats.list.useQuery({ projectId: projectId ?? '' }, { enabled: !!projectId })

  const createChat = trpc.chats.create.useMutation({
    onSuccess: (chat) => {
      utils.chats.list.invalidate()
      setChatId(chat.id)
      setSubchatId(chat.subchats[0]?.id ?? null)
      setNewChatOpen(false)
      setNewChatTitle('')
    }
  })
  const deleteChat = trpc.chats.delete.useMutation({
    onSuccess: () => utils.chats.list.invalidate()
  })
  const renameChat = trpc.chats.rename.useMutation({
    onSuccess: (_res, vars) => {
      utils.chats.list.invalidate()
      utils.chats.get.invalidate({ id: vars.id })
      setRenameTarget(null)
    }
  })

  const selectChat = useSelectChat()

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card">
      {/* Titlebar spacer (macOS traffic lights sit near the top-left and
          render larger on newer macOS; keep the logo/title well below them) */}
      <div className="titlebar-drag h-20 shrink-0 flex items-end px-3 pb-2">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-6 rounded" />
          <span className="font-geist text-sm font-medium tracking-wide lowercase leading-none text-foreground">
            yardarm
          </span>
        </div>
      </div>

      {/* Project picker */}
      <div className="flex items-center gap-1 px-2 py-2">
        <Select
          value={projectId ?? ''}
          onValueChange={(v) => {
            if (v !== projectId) {
              // The old project's chat must not leak into the new project's views.
              setChatId(null)
              setSubchatId(null)
            }
            setProjectId(v)
          }}
        >
          <Tip content="Switch between your projects" side="bottom">
            <SelectTrigger className="flex-1 h-8">
              <span className="flex items-center gap-1.5 truncate">
                <FolderGit2 size={13} className="shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Select project" />
              </span>
            </SelectTrigger>
          </Tip>
          <SelectContent>
            {(projects.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tip content="Project settings — MCP servers, commands, instructions, plugins">
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              disabled={!projectId}
              onClick={() => setProjectSettingsOpen(true)}
            >
              <FolderCog size={14} />
            </Button>
          </span>
        </Tip>
        <Tip content="Add a project — local folder or GitHub clone">
          <Button size="icon" variant="ghost" onClick={() => setAddProjectOpen('local')}>
            <Plus size={14} />
          </Button>
        </Tip>
      </div>

      {/* Chats */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Chats</span>
        <Tip content="Start a new chat in this project">
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              disabled={!projectId}
              onClick={() => setNewChatOpen(true)}
            >
              <MessageSquarePlus size={14} />
            </Button>
          </span>
        </Tip>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {(chats.data ?? [])
          .filter((c) => !c.archived)
          .map((c) => (
            <div
              key={c.id}
              onClick={() => selectChat(c.id)}
              className={cn(
                'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                chatId === c.id ? 'bg-accent' : 'hover:bg-accent/50'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{c.title}</div>
                <div className="truncate text-[10px] text-muted-foreground font-mono">
                  {c.branch ?? 'no worktree'} · {timeAgo(c.updatedAt)}
                </div>
              </div>
              <ChatStatusIndicator
                running={chatStatuses.get(c.id)?.running ?? false}
                awaiting={chatStatuses.get(c.id)?.awaiting ?? false}
                unseen={unseenChats.has(c.id)}
              />
              <Tip content="Rename this chat">
                <button
                  className="hidden group-hover:block text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    renameChat.reset() // don't show a stale error from a previous attempt
                    setRenameTitle(c.title)
                    setRenameTarget({ id: c.id, title: c.title })
                  }}
                >
                  <Pencil size={12} />
                </button>
              </Tip>
              <Tip content="Delete this chat and its worktree">
                <button
                  className="hidden group-hover:block text-muted-foreground hover:text-destructive cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    void confirmDialog({
                      title: 'Delete chat?',
                      description: `"${c.title}" and its worktree will be permanently deleted.`,
                      confirmLabel: 'Delete'
                    }).then((ok) => {
                      if (!ok) return
                      if (chatId === c.id) {
                        setChatId(null)
                        setSubchatId(null)
                      }
                      deleteChat.mutate({ id: c.id })
                    })
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </Tip>
            </div>
          ))}
        {projectId && (chats.data ?? []).filter((c) => !c.archived).length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            No chats yet
          </div>
        )}
        {deleteChat.error && (
          <div className="px-2 py-1 text-[11px] text-destructive selectable">
            Delete failed: {deleteChat.error.message}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-1 border-t border-border p-2">
        <Tip content="App settings — theme, API keys, models, providers" side="top">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={13} />
            Settings
          </Button>
        </Tip>
        <Tip content={isDark ? 'Switch to the light theme' : 'Switch to the dark theme'} side="top">
          <Button variant="ghost" size="icon" onClick={() => setTheme(isDark ? 'light' : 'dark')}>
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
          </Button>
        </Tip>
      </div>

      {/* New chat dialog */}
      <Dialog
        open={newChatOpen}
        onOpenChange={(o) => {
          setNewChatOpen(o)
          if (!o) {
            // Fresh form next time: drop the typed title and any stale error.
            setNewChatTitle('')
            createChat.reset()
          }
        }}
      >
        <DialogContent>
          <DialogTitle>Chat Topic</DialogTitle>
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground">
              Name the topic for this chat — you&apos;ll send messages to the agent after it&apos;s
              created.
            </div>
            <Input
              autoFocus
              placeholder="What are you working on?"
              value={newChatTitle}
              onChange={(e) => setNewChatTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newChatTitle.trim() && projectId) {
                  createChat.mutate({
                    projectId,
                    title: newChatTitle.trim(),
                    useWorktree
                  })
                }
              }}
            />
            <Tip content="Runs the chat on its own branch in a separate working copy, so the agent's edits never touch your checked-out files until you merge">
              <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={useWorktree} onCheckedChange={setUseWorktree} />
                Isolate in a git worktree
              </label>
            </Tip>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNewChatOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!newChatTitle.trim() || !projectId || createChat.isPending}
                onClick={() =>
                  projectId &&
                  createChat.mutate({ projectId, title: newChatTitle.trim(), useWorktree })
                }
              >
                {createChat.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
            {createChat.error && (
              <div className="text-xs text-destructive">{createChat.error.message}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename chat dialog */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogTitle>Rename chat</DialogTitle>
          <div className="space-y-3">
            <Input
              autoFocus
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameTitle.trim() && renameTarget) {
                  renameChat.mutate({ id: renameTarget.id, title: renameTitle.trim() })
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button
                disabled={!renameTitle.trim() || renameChat.isPending}
                onClick={() =>
                  renameTarget &&
                  renameChat.mutate({ id: renameTarget.id, title: renameTitle.trim() })
                }
              >
                {renameChat.isPending ? 'Renaming…' : 'Rename'}
              </Button>
            </div>
            {renameChat.error && (
              <div className="text-xs text-destructive selectable">{renameChat.error.message}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AddProjectDialog />
    </div>
  )
}
