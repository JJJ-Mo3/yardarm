/**
 * Kanban tab: read-only board of the current project's chats, grouped into
 * columns derived from live agent status (no persistence, no drag-and-drop).
 * Clicking a card selects the chat and jumps to the Chat tab; the unseen flag
 * clears automatically via the status tracker's selection effect.
 */
import React, { useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { chatStatusesAtom, mainTabAtom, selectedChatIdAtom, unseenChatsAtom } from '../../lib/atoms'
import { useSelectChat } from '../../lib/use-select-chat'
import { Badge } from '../../components/ui/badge'
import { Tip } from '../../components/ui/tooltip'
import { deriveKanbanColumn, KANBAN_COLUMNS, type KanbanColumnId } from './derive-column'

export function KanbanView({ projectId }: { projectId: string }): React.JSX.Element {
  const chatList = trpc.chats.list.useQuery({ projectId }).data
  const chatStatuses = useAtomValue(chatStatusesAtom)
  const unseenChats = useAtomValue(unseenChatsAtom)
  const selectedChatId = useAtomValue(selectedChatIdAtom)
  const setTab = useSetAtom(mainTabAtom)
  const selectChat = useSelectChat()

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

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {KANBAN_COLUMNS.map((col) => {
        const rows = byColumn.get(col.id) ?? []
        return (
          <div
            key={col.id}
            className="flex h-full w-64 shrink-0 flex-col rounded-lg border border-border bg-card"
          >
            <div className="flex shrink-0 items-center gap-2 px-3 py-2">
              <span className={cn('h-2 w-2 rounded-full', col.dotClass)} />
              <span className="text-xs font-medium">{col.label}</span>
              <Badge className="ml-auto">{rows.length}</Badge>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
              {rows.map((c) => (
                <Tip key={c.id} content="Open this chat in the Chat tab" side="bottom">
                  <button
                    onClick={() => {
                      selectChat(c.id)
                      setTab('chat')
                    }}
                    className={cn(
                      'w-full cursor-pointer rounded-md border border-border bg-background',
                      'px-2.5 py-2 text-left hover:bg-accent/50',
                      selectedChatId === c.id && 'border-ring'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-[13px]">{c.title}</div>
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', col.dotClass)} />
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {c.branch ?? 'no worktree'} · {timeAgo(c.updatedAt)}
                    </div>
                  </button>
                </Tip>
              ))}
              {rows.length === 0 && (
                <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  {col.empty}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
