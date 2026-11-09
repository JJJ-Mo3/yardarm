/**
 * Details-panel widget: chronological timeline of what the agent did in this
 * chat — prompts, marked runs, commands, file changes, subagent runs, model
 * switches, and checkpoints — derived purely from the stored transcript plus
 * the checkpoints query. File rows open the file in the Files tab.
 */
import React, { useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Bot,
  Cpu,
  FilePen,
  FilePlus2,
  Flag,
  FolderPlus,
  History,
  MessageSquare,
  Terminal,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { fileOpenRequestAtom, mainTabAtom, selectedChatIdAtom } from '../../../lib/atoms'
import { Tip } from '../../../components/ui/tooltip'
import { timeAgo } from '../../../lib/utils'
import {
  buildTimeline,
  type FileAction,
  type TimelineEvent,
  type TimelineEventKind
} from './timeline'
import type { StoredMessage } from '../../../../../shared/ui-message'

/** Latest events rendered by default; "Show earlier" reveals the rest. */
const VISIBLE_LIMIT = 200

/** Icon per event kind; file events key on their action instead. */
const ICONS: Record<Exclude<TimelineEventKind, 'file'> | FileAction, LucideIcon> = {
  prompt: MessageSquare,
  marker: Flag,
  command: Terminal,
  subagent: Bot,
  model: Cpu,
  checkpoint: History,
  edit: FilePen,
  write: FilePlus2,
  delete: Trash2,
  mkdir: FolderPlus
}

function Row({ event }: { event: TimelineEvent }): React.JSX.Element {
  const setMainTab = useSetAtom(mainTabAtom)
  const setFileOpenRequest = useSetAtom(fileOpenRequestAtom)
  const Icon = ICONS[event.kind === 'file' ? (event.action ?? 'edit') : event.kind]
  const suffix = event.count && event.count > 1 ? ` ×${event.count}` : ''
  const body = (
    <>
      <Icon
        size={11}
        className={`mt-0.5 shrink-0 ${event.failed ? 'text-red-500' : 'text-muted-foreground'}`}
      />
      <span
        className={`min-w-0 flex-1 truncate ${event.kind === 'command' ? 'font-mono' : ''} ${
          event.failed ? 'text-red-500' : ''
        }`}
        title={event.label}
      >
        {event.label}
        {suffix}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(event.ts)}</span>
    </>
  )
  if (event.kind === 'file' && event.path && event.action !== 'delete') {
    const path = event.path
    return (
      <Tip content={`Open ${path} in the Files tab`}>
        <span className="flex w-full">
          <button
            onClick={() => {
              setFileOpenRequest({ path })
              setMainTab('files')
            }}
            className="flex w-full min-w-0 items-start gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-accent cursor-pointer"
          >
            {body}
          </button>
        </span>
      </Tip>
    )
  }
  return <div className="flex min-w-0 items-start gap-1.5 px-1 py-0.5 text-[11px]">{body}</div>
}

export function TimelineWidget({ messages }: { messages: StoredMessage[] }): React.JSX.Element {
  const chatId = useAtomValue(selectedChatIdAtom)
  const checkpoints = trpc.checkpoints.list.useQuery(
    { chatId: chatId ?? '' },
    { enabled: !!chatId, refetchInterval: 8000, retry: false }
  )
  const events = useMemo(
    () => buildTimeline(messages, checkpoints.data),
    [messages, checkpoints.data]
  )
  const [showAll, setShowAll] = useState(false)

  if (events.length === 0) {
    return <div className="text-[11px] text-muted-foreground">No activity yet.</div>
  }
  const visible = showAll ? events : events.slice(-VISIBLE_LIMIT)
  const hidden = events.length - visible.length
  return (
    <div className="space-y-px">
      {hidden > 0 && (
        <Tip content="Show the earlier timeline events currently hidden">
          <button
            onClick={() => setShowAll(true)}
            className="px-1 pb-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Show {hidden} earlier {hidden === 1 ? 'event' : 'events'}
          </button>
        </Tip>
      )}
      {visible.map((event) => (
        <Row key={event.id} event={event} />
      ))}
    </div>
  )
}
