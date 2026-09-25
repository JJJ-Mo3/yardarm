/**
 * One extra pane of the split chat view: a chat picker (any other chat in the
 * current project not already shown in another pane) plus an independent,
 * non-primary ChatView. Each pane's selection lives in its splitPanesAtom
 * entry (ephemeral — cleared when the pane closes or the project changes).
 */
import React, { useEffect, useState } from 'react'
import { Columns2, Plus, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { type SplitPaneSel } from '../../lib/atoms'
import { CHAT_DRAG_TYPE } from '../sidebar/Sidebar'
import { Button } from '../../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Tip } from '../../components/ui/tooltip'
import { ChatView } from './ChatView'

export function SplitChatPane({
  pane,
  projectId,
  projectPath,
  excludeChatIds,
  onChange,
  onClose,
  onAdd
}: {
  pane: SplitPaneSel
  projectId: string
  projectPath: string | null
  /** Chats shown elsewhere (primary pane + other split panes) — excluded from the picker. */
  excludeChatIds: string[]
  onChange: (next: SplitPaneSel) => void
  onClose: () => void
  /** Adds another split pane; null when the pane cap is reached (button disabled). */
  onAdd: (() => void) | null
}): React.JSX.Element {
  const { chatId, subchatId } = pane
  // Sidebar chat rows can be dropped anywhere on the pane to show them here.
  const [dragOver, setDragOver] = useState(false)

  const chats = trpc.chats.list.useQuery({ projectId })
  const chat = trpc.chats.get.useQuery({ id: chatId ?? '' }, { enabled: !!chatId })

  const options = (chats.data ?? []).filter((c) => !c.archived && !excludeChatIds.includes(c.id))

  // Reset when the picked chat disappears (deleted, archived, or now shown in
  // another pane) — the picker only ever offers valid targets.
  useEffect(() => {
    if (chatId && chats.data && !options.some((c) => c.id === chatId)) {
      onChange({ ...pane, chatId: null, subchatId: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chats.data, excludeChatIds.join(',')])

  // Default to the chat's first subchat once loaded (or after a chat switch).
  useEffect(() => {
    if (!chatId || !chat.data || chat.data.id !== chatId) return
    const subs = chat.data.subchats
    if (subs.length === 0) return
    if (!subchatId || !subs.some((s) => s.id === subchatId)) {
      onChange({ ...pane, subchatId: subs[0].id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chat.data, subchatId])

  const cwd = chat.data?.worktreePath ?? projectPath
  const subchats = chat.data?.subchats ?? []

  return (
    <div
      className={cn(
        'flex h-full min-w-0 flex-1 flex-col',
        dragOver && 'outline-1 -outline-offset-1 outline-dashed outline-sky-500/50'
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(CHAT_DRAG_TYPE)
        setDragOver(false)
        if (!id || excludeChatIds.includes(id)) return
        e.preventDefault()
        if (id !== chatId) onChange({ ...pane, chatId: id, subchatId: null })
      }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <Select
          value={chatId ?? ''}
          onValueChange={(id) => onChange({ ...pane, chatId: id, subchatId: null })}
        >
          <Tip content="Chat shown in this split pane">
            <SelectTrigger className="h-6 min-w-0 flex-1 text-[11px]">
              <SelectValue placeholder="Pick a chat…" />
            </SelectTrigger>
          </Tip>
          <SelectContent>
            {options.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-[11px]">
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {subchats.length > 1 && (
          <Select
            value={subchatId ?? ''}
            onValueChange={(id) => onChange({ ...pane, subchatId: id })}
          >
            <Tip content="Conversation tab of this chat to show">
              <SelectTrigger className="h-6 w-20 shrink-0 text-[11px]">
                <SelectValue placeholder="Tab" />
              </SelectTrigger>
            </Tip>
            <SelectContent>
              {subchats.map((sc, i) => (
                <SelectItem key={sc.id} value={sc.id} className="text-[11px]">
                  Tab {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Tip
          content={
            onAdd
              ? 'Add another split pane (up to 6 side by side)'
              : 'Pane limit reached (6 side by side)'
          }
        >
          <span className="inline-flex shrink-0">
            <Button size="icon" variant="ghost" disabled={!onAdd} onClick={() => onAdd?.()}>
              <Plus size={12} />
            </Button>
          </span>
        </Tip>
        <Tip content="Close this split pane">
          <Button size="icon" variant="ghost" className="shrink-0" onClick={onClose}>
            <X size={12} />
          </Button>
        </Tip>
      </div>
      <div className="min-h-0 flex-1">
        {chatId && subchatId && chat.data?.id === chatId ? (
          <ChatView
            key={subchatId}
            subchatId={subchatId}
            projectRoot={cwd}
            baseBranch={chat.data?.baseBranch ?? null}
            primary={false}
            onForkSubchat={(id) => onChange({ ...pane, subchatId: id })}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Columns2 size={24} strokeWidth={1.5} />
            <div className="text-xs">
              {options.length > 0
                ? 'Pick a chat above (or drag one from the sidebar) to show it side by side'
                : 'No other chats in this project yet'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
