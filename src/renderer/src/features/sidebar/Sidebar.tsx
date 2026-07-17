import React, { useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { FolderGit2, MessageSquarePlus, Plus, Settings, Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import {
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom,
  settingsOpenAtom
} from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'

export function Sidebar(): React.JSX.Element {
  const [projectId, setProjectId] = useAtom(selectedProjectIdAtom)
  const [chatId, setChatId] = useAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatTitle, setNewChatTitle] = useState('')
  const [useWorktree, setUseWorktree] = useState(true)

  const utils = trpc.useUtils()
  const projects = trpc.projects.list.useQuery()
  const chats = trpc.chats.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId }
  )

  const addProject = trpc.projects.addViaDialog.useMutation({
    onSuccess: (p) => {
      utils.projects.list.invalidate()
      if (p) setProjectId(p.id)
    }
  })
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

  function selectChat(id: string): void {
    setChatId(id)
    utils.chats.get.fetch({ id }).then((chat) => {
      setSubchatId(chat?.subchats[0]?.id ?? null)
    })
  }

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card">
      {/* Titlebar spacer (macOS traffic lights) */}
      <div className="titlebar-drag h-10 shrink-0 flex items-end px-3 pb-1">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">codezero</span>
      </div>

      {/* Project picker */}
      <div className="flex items-center gap-1 px-2 py-2">
        <Select value={projectId ?? ''} onValueChange={(v) => setProjectId(v)}>
          <SelectTrigger className="flex-1 h-8">
            <span className="flex items-center gap-1.5 truncate">
              <FolderGit2 size={13} className="shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Select project" />
            </span>
          </SelectTrigger>
          <SelectContent>
            {(projects.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          title="Add project folder"
          disabled={addProject.isPending}
          onClick={() => addProject.mutate()}
        >
          <Plus size={14} />
        </Button>
      </div>

      {/* Chats */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Chats</span>
        <Button
          size="icon"
          variant="ghost"
          title="New chat"
          disabled={!projectId}
          onClick={() => setNewChatOpen(true)}
        >
          <MessageSquarePlus size={14} />
        </Button>
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
              <button
                title="Delete chat"
                className="hidden group-hover:block text-muted-foreground hover:text-destructive cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Delete chat "${c.title}" and its worktree?`)) {
                    if (chatId === c.id) {
                      setChatId(null)
                      setSubchatId(null)
                    }
                    deleteChat.mutate({ id: c.id })
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        {projectId && (chats.data ?? []).filter((c) => !c.archived).length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            No chats yet
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={13} />
          Settings
        </Button>
      </div>

      {/* New chat dialog */}
      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent>
          <DialogTitle>New chat</DialogTitle>
          <div className="space-y-3">
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
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={useWorktree} onCheckedChange={setUseWorktree} />
              Isolate in a git worktree
            </label>
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
    </div>
  )
}
