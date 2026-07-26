/**
 * Right-hand pane of the split chat view: a chat picker (any other chat in
 * the current project) plus an independent, non-primary ChatView. Selection
 * lives in ephemeral atoms cleared when the split closes or the project
 * changes; only the divider ratio persists.
 */
import React, { useEffect } from 'react'
import { useAtom } from 'jotai'
import { Columns2, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { splitChatIdAtom, splitSubchatIdAtom } from '../../lib/atoms'
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
  projectId,
  projectPath,
  primaryChatId,
  onClose
}: {
  projectId: string
  projectPath: string | null
  /** The chat open in the primary pane — excluded from the picker. */
  primaryChatId: string | null
  onClose: () => void
}): React.JSX.Element {
  const [chatId, setChatId] = useAtom(splitChatIdAtom)
  const [subchatId, setSubchatId] = useAtom(splitSubchatIdAtom)

  const chats = trpc.chats.list.useQuery({ projectId })
  const chat = trpc.chats.get.useQuery({ id: chatId ?? '' }, { enabled: !!chatId })

  const options = (chats.data ?? []).filter((c) => !c.archived && c.id !== primaryChatId)

  // Reset when the picked chat disappears (deleted, archived, or became the
  // primary chat) — the picker only ever offers valid targets.
  useEffect(() => {
    if (chatId && chats.data && !options.some((c) => c.id === chatId)) {
      setChatId(null)
      setSubchatId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chats.data, primaryChatId])

  // Default to the chat's first subchat once loaded (or after a chat switch).
  useEffect(() => {
    if (!chatId || !chat.data || chat.data.id !== chatId) return
    const subs = chat.data.subchats
    if (subs.length === 0) return
    if (!subchatId || !subs.some((s) => s.id === subchatId)) setSubchatId(subs[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chat.data, subchatId])

  const cwd = chat.data?.worktreePath ?? projectPath
  const subchats = chat.data?.subchats ?? []

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <Select
          value={chatId ?? ''}
          onValueChange={(id) => {
            setChatId(id)
            setSubchatId(null)
          }}
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
          <Select value={subchatId ?? ''} onValueChange={setSubchatId}>
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
        <Tip content="Close the split pane">
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
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Columns2 size={24} strokeWidth={1.5} />
            <div className="text-xs">
              {options.length > 0
                ? 'Pick a chat above to show it side by side'
                : 'No other chats in this project yet'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
