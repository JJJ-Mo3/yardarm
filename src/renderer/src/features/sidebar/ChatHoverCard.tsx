/**
 * Sidebar chat-row hover preview: a hover card with the chat's live status,
 * branch, last assistant reply snippet, and the branch's open PR (if any).
 * The card body only mounts while open (Radix renders content lazily), so
 * its queries poll only during an active hover.
 */
import React from 'react'
import { useAtomValue } from 'jotai'
import { GitPullRequest, Loader2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { timeAgo } from '../../lib/utils'
import { chatStatusesAtom, unseenChatsAtom } from '../../lib/atoms'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../components/ui/hover-card'

function PreviewBody({ chatId }: { chatId: string }): React.JSX.Element {
  const preview = trpc.chats.preview.useQuery({ chatId }, { refetchInterval: 2000 })
  const chatStatuses = useAtomValue(chatStatusesAtom)
  const unseenChats = useAtomValue(unseenChatsAtom)
  const pr = trpc.git.branchPr.useQuery(
    { cwd: preview.data?.cwd ?? '' },
    { enabled: !!preview.data?.cwd && !!preview.data?.branch, staleTime: 60_000, retry: false }
  )

  if (!preview.data) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Loading preview…
      </div>
    )
  }
  const d = preview.data
  const status = chatStatuses.get(chatId)
  const statusLabel = status?.awaiting
    ? 'Awaiting approval'
    : status?.running
      ? 'Running…'
      : unseenChats.has(chatId)
        ? 'Unread reply'
        : 'Idle'
  const statusClass = status?.awaiting
    ? 'text-amber-500'
    : status?.running
      ? 'text-sky-500'
      : unseenChats.has(chatId)
        ? 'text-blue-500'
        : 'text-muted-foreground'
  return (
    <div className="space-y-1.5">
      <div className="truncate text-[12px] font-medium" title={d.title}>
        {d.title}
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
        <span className={statusClass}>{statusLabel}</span>
        <span className="truncate">
          {d.branch ?? 'no worktree'} · {timeAgo(d.updatedAt)}
        </span>
      </div>
      {d.lastAssistantSnippet && (
        <div className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-4 text-foreground/90">
          {d.lastAssistantSnippet}
        </div>
      )}
      {!d.lastAssistantSnippet && (
        <div className="text-[11px] text-muted-foreground">No agent replies yet</div>
      )}
      {pr.data && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <GitPullRequest size={11} className="shrink-0 text-emerald-500" />
          <span className="truncate">
            #{pr.data.number} · {pr.data.title}
          </span>
        </div>
      )}
    </div>
  )
}

/** Wraps a sidebar row's text region; shows the preview card after a short hover. */
export function ChatHoverCard({
  chatId,
  children
}: {
  chatId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <HoverCard openDelay={500} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" collisionPadding={8}>
        <PreviewBody chatId={chatId} />
      </HoverCardContent>
    </HoverCard>
  )
}
