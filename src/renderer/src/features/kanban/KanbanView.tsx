/**
 * Kanban tab: authored task cards in Backlog / To do can be edited, reordered
 * (native HTML5 drag-and-drop with float-midpoint sort orders), and dispatched
 * — dropping a card on In progress (or its Play button) creates a chat via the
 * kanban router and starts the agent on the card's prompt. Dispatched cards
 * are then represented by their live chat in the status-derived columns
 * (untouched derive-column logic); ready/idle chats backed by a card get a
 * "mark done" affordance, and done cards land in the Done column.
 */
import React, { useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Check, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { chatStatusesAtom, mainTabAtom, selectedChatIdAtom, unseenChatsAtom } from '../../lib/atoms'
import { useSelectChat } from '../../lib/use-select-chat'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { deriveKanbanColumn, KANBAN_COLUMNS, type KanbanColumnId } from './derive-column'
import { bucketCards, sortOrderBefore, type BucketableCard } from './bucket-cards'

const DRAG_TYPE = 'text/yardarm-card'

type AuthoredColumnId = 'backlog' | 'todo'

interface CardRow extends BucketableCard {
  id: string
  title: string
  prompt: string
  chatId: string | null
  useWorktree: boolean
  updatedAt: number
}

const AUTHORED_COLUMNS: Array<{
  id: AuthoredColumnId
  label: string
  dotClass: string
  empty: string
}> = [
  {
    id: 'backlog',
    label: 'Backlog',
    dotClass: 'bg-muted-foreground/50',
    empty: 'No cards — add a task below'
  },
  { id: 'todo', label: 'To do', dotClass: 'bg-violet-500', empty: 'Nothing queued' }
]

const DONE_COLUMN = { label: 'Done', dotClass: 'bg-green-500', empty: 'Nothing marked done' }

/** Sort order that appends to the end of a bucket. */
function appendOrder(bucket: CardRow[]): number {
  return bucket.length ? bucket[bucket.length - 1].sortOrder + 1 : 1
}

function ColumnShell({
  label,
  dotClass,
  count,
  onDragOver,
  onDrop,
  footer,
  children
}: {
  label: string
  dotClass: string
  count: number
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  footer?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="flex h-full w-64 shrink-0 flex-col rounded-lg border border-border bg-card"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className={cn('h-2 w-2 rounded-full', dotClass)} />
        <span className="text-xs font-medium">{label}</span>
        <Badge className="ml-auto">{count}</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">{children}</div>
      {footer}
    </div>
  )
}

export function KanbanView({ projectId }: { projectId: string }): React.JSX.Element {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const chatList = trpc.chats.list.useQuery({ projectId }).data
  const cardQuery = trpc.kanban.list.useQuery({ projectId })
  const chatStatuses = useAtomValue(chatStatusesAtom)
  const unseenChats = useAtomValue(unseenChatsAtom)
  const selectedChatId = useAtomValue(selectedChatIdAtom)
  const setTab = useSetAtom(mainTabAtom)
  const selectChat = useSelectChat()

  const [composerCol, setComposerCol] = useState<AuthoredColumnId | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newWorktree, setNewWorktree] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editPrompt, setEditPrompt] = useState('')

  const invalidate = (): void => {
    void utils.kanban.list.invalidate({ projectId })
  }
  const create = trpc.kanban.create.useMutation({
    onSuccess: () => {
      setNewTitle('')
      setNewPrompt('')
      invalidate()
    }
  })
  const update = trpc.kanban.update.useMutation({
    onSuccess: () => {
      setEditingId(null)
      invalidate()
    }
  })
  const remove = trpc.kanban.remove.useMutation({ onSuccess: invalidate })
  const dispatch = trpc.kanban.dispatch.useMutation({
    onSuccess: () => {
      invalidate()
      void utils.chats.list.invalidate()
    }
  })
  const mutationError = create.error ?? update.error ?? remove.error ?? dispatch.error

  const cards = useMemo((): CardRow[] => cardQuery.data ?? [], [cardQuery.data])
  const buckets = useMemo(() => bucketCards(cards), [cards])

  const byColumn = useMemo(() => {
    const map = new Map<KanbanColumnId, NonNullable<typeof chatList>>(
      KANBAN_COLUMNS.map((c) => [c.id, []])
    )
    for (const c of chatList ?? []) {
      const col = deriveKanbanColumn({
        archived: c.archived,
        running: chatStatuses.get(c.id)?.running ?? false,
        awaiting: chatStatuses.get(c.id)?.awaiting ?? false,
        unseen: unseenChats.has(c.id)
      })
      if (col) map.get(col)!.push(c)
    }
    return map
  }, [chatList, chatStatuses, unseenChats])

  const allowDrop = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault()
  }
  const onDragStart = (e: React.DragEvent, id: string): void => {
    e.dataTransfer.setData(DRAG_TYPE, id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const confirmDispatch = (card: CardRow): void => {
    void confirmDialog({
      title: 'Dispatch this card?',
      description: `"${card.title}" gets its own chat${card.useWorktree ? ' and worktree' : ''}, and the agent starts on its prompt.`,
      confirmLabel: 'Dispatch'
    }).then((ok) => {
      if (ok) dispatch.mutate({ id: card.id })
    })
  }

  /** Handle a card dropped on a column body or on another card (before). */
  const onDropCard = (
    cardId: string,
    target: AuthoredColumnId | 'done' | 'in-progress',
    before?: CardRow
  ): void => {
    const card = cards.find((c) => c.id === cardId)
    if (!card) return
    if (target === 'in-progress') {
      if (!card.chatId) confirmDispatch(card)
      return
    }
    // Dispatched cards live with their chat; only Done can hold them.
    if (target !== 'done' && card.chatId) return
    const bucket = buckets[target]
    const sortOrder =
      before && before.id !== card.id ? sortOrderBefore(bucket, before) : appendOrder(bucket)
    update.mutate({ id: card.id, column: target, sortOrder })
  }

  const dropHandler =
    (target: AuthoredColumnId | 'done' | 'in-progress', before?: CardRow) =>
    (e: React.DragEvent): void => {
      const id = e.dataTransfer.getData(DRAG_TYPE)
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      onDropCard(id, target, before)
    }

  const renderCardChip = (
    card: CardRow,
    columnId: AuthoredColumnId | 'done'
  ): React.JSX.Element => {
    if (editingId === card.id) {
      return (
        <div key={card.id} className="space-y-1 rounded-md border border-border bg-accent/50 p-2">
          <Input
            autoFocus
            placeholder="Title"
            value={editTitle}
            onChange={(ev) => setEditTitle(ev.target.value)}
            className="h-6 text-[11px]"
          />
          <Textarea
            placeholder="Prompt for the agent"
            value={editPrompt}
            onChange={(ev) => setEditPrompt(ev.target.value)}
            rows={3}
            className="text-[11px]"
          />
          <div className="flex justify-end gap-1">
            <Tip content="Cancel editing">
              <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                <X size={12} />
              </Button>
            </Tip>
            <Tip content="Save the card's title and prompt">
              <span className="inline-flex">
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={!editTitle.trim() || !editPrompt.trim() || update.isPending}
                  onClick={() =>
                    update.mutate({
                      id: card.id,
                      title: editTitle.trim(),
                      prompt: editPrompt.trim()
                    })
                  }
                >
                  <Check size={12} />
                </Button>
              </span>
            </Tip>
          </div>
        </div>
      )
    }
    return (
      <div
        key={card.id}
        draggable
        onDragStart={(e) => onDragStart(e, card.id)}
        onDragOver={allowDrop}
        onDrop={dropHandler(columnId === 'done' ? 'done' : columnId, card)}
        onClick={
          card.chatId
            ? () => {
                selectChat(card.chatId!)
                setTab('chat')
              }
            : undefined
        }
        className={cn(
          'group rounded-md border border-border bg-background px-2.5 py-2',
          card.chatId ? 'cursor-pointer hover:bg-accent/50' : 'cursor-grab'
        )}
      >
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1 truncate text-[13px]">{card.title}</div>
          <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
            {!card.chatId && columnId !== 'done' && (
              <Tip content="Dispatch: create a chat and start the agent on this card's prompt">
                <button
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    confirmDispatch(card)
                  }}
                >
                  <Play size={11} />
                </button>
              </Tip>
            )}
            <Tip content="Edit this card's title and prompt">
              <button
                className="cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={(ev) => {
                  ev.stopPropagation()
                  setEditingId(card.id)
                  setEditTitle(card.title)
                  setEditPrompt(card.prompt)
                }}
              >
                <Pencil size={11} />
              </button>
            </Tip>
            <Tip content="Delete this card (its chat, if any, is kept)">
              <button
                className="cursor-pointer text-muted-foreground hover:text-destructive"
                onClick={(ev) => {
                  ev.stopPropagation()
                  void confirmDialog({
                    title: 'Delete card?',
                    description: `"${card.title}" is removed from the board${card.chatId ? '; its chat is kept' : ''}.`,
                    confirmLabel: 'Delete'
                  }).then((ok) => {
                    if (ok) remove.mutate({ id: card.id })
                  })
                }}
              >
                <Trash2 size={11} />
              </button>
            </Tip>
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{card.prompt}</div>
        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {card.useWorktree ? 'worktree' : 'in place'} · {timeAgo(card.updatedAt)}
        </div>
      </div>
    )
  }

  const composerFooter = (col: AuthoredColumnId): React.JSX.Element =>
    composerCol === col ? (
      <div className="shrink-0 space-y-1.5 border-t border-border p-2">
        <Input
          autoFocus
          placeholder="Title"
          value={newTitle}
          onChange={(ev) => setNewTitle(ev.target.value)}
          className="h-7 text-[12px]"
        />
        <Textarea
          placeholder="Prompt for the agent"
          value={newPrompt}
          onChange={(ev) => setNewPrompt(ev.target.value)}
          rows={3}
          className="text-[12px]"
        />
        <div className="flex items-center gap-2">
          <Tip content="Run this task in its own git worktree when dispatched">
            <span className="inline-flex items-center gap-1.5">
              <Switch checked={newWorktree} onCheckedChange={setNewWorktree} />
              <span className="text-[11px] text-muted-foreground">Worktree</span>
            </span>
          </Tip>
          <div className="ml-auto flex gap-1">
            <Tip content="Close the card composer">
              <Button size="icon" variant="ghost" onClick={() => setComposerCol(null)}>
                <X size={12} />
              </Button>
            </Tip>
            <Tip content="Add this card to the column">
              <span className="inline-flex">
                <Button
                  size="sm"
                  disabled={!newTitle.trim() || !newPrompt.trim() || create.isPending}
                  onClick={() =>
                    create.mutate({
                      projectId,
                      title: newTitle.trim(),
                      prompt: newPrompt.trim(),
                      column: col,
                      useWorktree: newWorktree
                    })
                  }
                >
                  Add
                </Button>
              </span>
            </Tip>
          </div>
        </div>
      </div>
    ) : (
      <div className="shrink-0 border-t border-border p-1.5">
        <Tip content="Add a task card to this column">
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start text-muted-foreground"
            onClick={() => setComposerCol(col)}
          >
            <Plus size={13} />
            Add card
          </Button>
        </Tip>
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      {mutationError && (
        <div className="selectable shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-destructive">
          {mutationError.message}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {AUTHORED_COLUMNS.map((col) => {
          const rows = buckets[col.id]
          return (
            <ColumnShell
              key={col.id}
              label={col.label}
              dotClass={col.dotClass}
              count={rows.length}
              onDragOver={allowDrop}
              onDrop={dropHandler(col.id)}
              footer={composerFooter(col.id)}
            >
              {rows.map((card) => renderCardChip(card, col.id))}
              {rows.length === 0 && (
                <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  {col.empty}
                </div>
              )}
            </ColumnShell>
          )
        })}
        {KANBAN_COLUMNS.map((col) => {
          const rows = byColumn.get(col.id) ?? []
          const isDispatchTarget = col.id === 'in-progress'
          return (
            <ColumnShell
              key={col.id}
              label={col.label}
              dotClass={col.dotClass}
              count={rows.length}
              onDragOver={isDispatchTarget ? allowDrop : undefined}
              onDrop={isDispatchTarget ? dropHandler('in-progress') : undefined}
            >
              {rows.map((c) => {
                const card = buckets.byChatId.get(c.id)
                const canMarkDone =
                  card && card.column !== 'done' && (col.id === 'ready' || col.id === 'idle')
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      selectChat(c.id)
                      setTab('chat')
                    }}
                    className={cn(
                      'group cursor-pointer rounded-md border border-border bg-background',
                      'px-2.5 py-2 hover:bg-accent/50',
                      selectedChatId === c.id && 'border-ring'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-[13px]">{c.title}</div>
                      {canMarkDone && (
                        <Tip content="Mark this card's task as done">
                          <button
                            className="hidden shrink-0 cursor-pointer text-muted-foreground hover:text-foreground group-hover:block"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              update.mutate({
                                id: card.id,
                                column: 'done',
                                sortOrder: appendOrder(buckets.done)
                              })
                            }}
                          >
                            <Check size={12} />
                          </button>
                        </Tip>
                      )}
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', col.dotClass)} />
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {c.branch ?? 'no worktree'} · {timeAgo(c.updatedAt)}
                    </div>
                  </div>
                )
              })}
              {rows.length === 0 && (
                <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  {col.empty}
                </div>
              )}
            </ColumnShell>
          )
        })}
        <ColumnShell
          label={DONE_COLUMN.label}
          dotClass={DONE_COLUMN.dotClass}
          count={buckets.done.length}
          onDragOver={allowDrop}
          onDrop={dropHandler('done')}
        >
          {buckets.done.map((card) => renderCardChip(card, 'done'))}
          {buckets.done.length === 0 && (
            <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
              {DONE_COLUMN.empty}
            </div>
          )}
        </ColumnShell>
      </div>
    </div>
  )
}
