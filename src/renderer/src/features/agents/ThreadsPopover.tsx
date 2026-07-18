import React, { useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  ArrowLeftRight,
  Check,
  Copy,
  ExternalLink,
  MessagesSquare,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { selectedChatIdAtom, selectedSubchatIdAtom } from '../../lib/atoms'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useConfirm } from '../../components/ConfirmDialog'

export function ThreadsPopover({
  subchatId,
  open,
  onOpenChange
}: {
  subchatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const chatId = useAtomValue(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const utils = trpc.useUtils()

  const threads = trpc.agent.listThreads.useQuery(
    { subchatId },
    { enabled: open, staleTime: 10_000 }
  )
  const invalidate = (): void => {
    utils.agent.listThreads.invalidate({ subchatId })
  }
  const newThread = trpc.agent.newThread.useMutation({ onSuccess: invalidate })
  const switchThread = trpc.agent.switchThread.useMutation({ onSuccess: invalidate })
  const renameThread = trpc.agent.renameThread.useMutation({
    onSuccess: () => {
      setRenamingId(null)
      invalidate()
    }
  })
  const cloneThread = trpc.agent.cloneThread.useMutation({ onSuccess: invalidate })
  const deleteThread = trpc.agent.deleteThread.useMutation({ onSuccess: invalidate })
  const createSubchat = trpc.chats.createSubchat.useMutation({
    onSuccess: (subchat) => {
      utils.chats.get.invalidate({ id: subchat.chatId })
      setSubchatId(subchat.id)
      onOpenChange(false)
    }
  })

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const confirmDialog = useConfirm()

  const list = threads.data ?? []
  const active = list.find((t) => t.active)
  const busy =
    newThread.isPending ||
    switchThread.isPending ||
    cloneThread.isPending ||
    deleteThread.isPending ||
    createSubchat.isPending

  const error =
    threads.error ??
    newThread.error ??
    switchThread.error ??
    renameThread.error ??
    cloneThread.error ??
    deleteThread.error ??
    createSubchat.error

  function label(t: { title?: string; preview?: string; id: string }): string {
    return t.title || t.preview || t.id.slice(0, 8)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          title="Threads (/threads)"
          className="flex min-w-0 max-w-48 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <MessagesSquare size={11} className="shrink-0" />
          <span className="truncate">{active ? label(active) : 'threads'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Threads</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={busy}
            onClick={() => newThread.mutate({ subchatId })}
          >
            <Plus size={11} />
            New thread
          </Button>
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {threads.isLoading && (
            <div className="py-3 text-center text-[11px] text-muted-foreground">Loading…</div>
          )}
          {!threads.isLoading && list.length === 0 && (
            <div className="py-3 text-center text-[11px] text-muted-foreground">
              No threads yet.
            </div>
          )}
          {list.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group rounded border px-2 py-1.5',
                t.active ? 'border-primary/50 bg-accent/40' : 'border-border'
              )}
            >
              {renamingId === t.id ? (
                <div className="flex items-center gap-1">
                  <Input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && title.trim()) {
                        renameThread.mutate({ subchatId, title: title.trim() })
                      }
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="h-6 text-[11px]"
                    placeholder="Thread title"
                  />
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={!title.trim() || renameThread.isPending}
                    onClick={() => renameThread.mutate({ subchatId, title: title.trim() })}
                  >
                    <Check size={11} />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px]">{label(t)}</span>
                  {t.active && (
                    <span className="shrink-0 rounded bg-primary/15 px-1 text-[9px] text-primary">
                      current
                    </span>
                  )}
                </div>
              )}
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="flex-1 truncate">
                  {timeAgo(t.updatedAt)}
                  {t.totalTokens ? ` · ${Intl.NumberFormat().format(t.totalTokens)} tok` : ''}
                </span>
                <span className="hidden items-center gap-1.5 group-hover:flex">
                  {t.active ? (
                    <>
                      <button
                        title="Rename thread (/name)"
                        className="hover:text-foreground cursor-pointer"
                        onClick={() => {
                          setRenamingId(t.id)
                          setTitle(t.title ?? '')
                        }}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        title="Clone thread (/clone)"
                        className="hover:text-foreground cursor-pointer"
                        disabled={busy}
                        onClick={() => cloneThread.mutate({ subchatId })}
                      >
                        <Copy size={11} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        title="Open in a new tab (keeps transcripts separate)"
                        className="hover:text-foreground cursor-pointer"
                        disabled={busy || !chatId}
                        onClick={() =>
                          chatId &&
                          createSubchat.mutate({ chatId, mastraThreadId: t.id })
                        }
                      >
                        <ExternalLink size={11} />
                      </button>
                      <button
                        title="Switch this chat to the thread"
                        className="hover:text-foreground cursor-pointer"
                        disabled={busy}
                        onClick={() => switchThread.mutate({ subchatId, threadId: t.id })}
                      >
                        <ArrowLeftRight size={11} />
                      </button>
                    </>
                  )}
                  <button
                    title="Delete thread"
                    className="hover:text-destructive cursor-pointer"
                    disabled={busy}
                    onClick={() => {
                      void confirmDialog({
                        title: 'Delete thread?',
                        description: `"${label(t)}" will be permanently deleted. This cannot be undone.`,
                        confirmLabel: 'Delete'
                      }).then((ok) => {
                        if (ok) deleteThread.mutate({ subchatId, threadId: t.id })
                      })
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-2 text-[11px] text-destructive selectable">{error.message}</div>
        )}
        <div className="mt-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
          Threads are shared with the mastracode CLI for this worktree.
        </div>
      </PopoverContent>
    </Popover>
  )
}
