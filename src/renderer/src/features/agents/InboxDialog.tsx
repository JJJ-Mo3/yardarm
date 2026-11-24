/**
 * Inbox dialog (`/inbox`, ⌘K → "Open inbox", the sidebar Inbox button, or its
 * shortcut): every chat across all projects that wants attention, grouped as
 * Needs approval / Asked a question / Finished — not viewed / Running. Live
 * state comes from the main process (agent.inbox — only chats whose agent
 * host is running in this session are reported); the finished-not-viewed
 * flags are the renderer's own unseen tracking. Rows jump to their chat;
 * approval rows can be approved or denied in place.
 */
import React, { useEffect, useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  Check,
  CircleDot,
  Inbox,
  Loader2,
  MessageCircleQuestion,
  ShieldQuestion
} from 'lucide-react'
import { buildInboxGroups, type InboxGroupId, type InboxRow } from '@shared/inbox'
import { trpc } from '../../lib/trpc'
import { inboxOpenAtom, subchatStatusesAtom, unseenChatsAtom } from '../../lib/atoms'
import { useOpenChat } from '../../lib/use-open-chat'
import { timeAgo } from '../../lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'

const GROUP_ICONS: Record<InboxGroupId, React.ReactNode> = {
  approval: <ShieldQuestion size={12} className="text-amber-600 dark:text-amber-500" />,
  question: <MessageCircleQuestion size={12} className="text-violet-400" />,
  finished: <Check size={12} className="text-sky-500" />,
  running: <CircleDot size={12} className="text-emerald-500" />
}

export function InboxDialog(): React.JSX.Element {
  const [open, setOpen] = useAtom(inboxOpenAtom)
  const unseen = useAtomValue(unseenChatsAtom)
  const statuses = useAtomValue(subchatStatusesAtom)
  const openChat = useOpenChat()

  const unseenChatIds = useMemo(() => [...unseen].sort(), [unseen])
  const inbox = trpc.agent.inbox.useQuery(
    { unseenChatIds },
    { enabled: open, refetchInterval: open ? 5000 : false, placeholderData: (prev) => prev }
  )
  // Live status changes (run start/end, gates) arrive on the statusAll stream
  // the app already mirrors into an atom — refresh as soon as one lands.
  const { refetch } = inbox
  useEffect(() => {
    if (open) void refetch()
  }, [open, statuses, refetch])

  const approve = trpc.agent.approve.useMutation({ onSettled: () => void refetch() })
  const groups = useMemo(() => (inbox.data ? buildInboxGroups(inbox.data) : []), [inbox.data])

  const jump = (row: InboxRow): void => {
    setOpen(false)
    openChat({ projectId: row.projectId, chatId: row.chatId, subchatId: row.subchatId })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogTitle className="flex items-center gap-2">
          <Inbox size={14} />
          Inbox
        </DialogTitle>
        <DialogDescription className="mb-2 text-xs">
          Chats across all projects that are waiting on you or still working. Only chats whose agent
          is active in this session are listed.
        </DialogDescription>
        {inbox.error && (
          <div className="selectable mb-2 text-xs text-destructive">
            Could not load the inbox: {inbox.error.message}
          </div>
        )}
        {approve.error && (
          <div className="selectable mb-2 text-xs text-destructive">
            Approval failed: {approve.error.message}
          </div>
        )}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {inbox.isLoading && (
            <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              Loading…
            </div>
          )}
          {!inbox.isLoading && groups.length === 0 && !inbox.error && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Nothing needs you right now — no chats are running, waiting for approval, or finished
              unviewed.
            </div>
          )}
          {groups.map((group) => (
            <section key={group.id} aria-label={group.label}>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {GROUP_ICONS[group.id]}
                {group.label}
                <span className="tabular-nums">({group.rows.length})</span>
              </div>
              <div className="space-y-1">
                {group.rows.map((row) => (
                  <div key={row.key} className="rounded-md border border-border">
                    <Tip content={`Open "${row.chatTitle}" in ${row.projectName}`}>
                      <button
                        onClick={() => jump(row)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">
                            {row.chatTitle}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {row.projectName}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {group.id === 'running' ? 'for ' : ''}
                          {timeAgo(row.since)}
                          {group.id === 'running' || timeAgo(row.since) === 'now' ? '' : ' ago'}
                        </span>
                      </button>
                    </Tip>
                    {row.questions.map((q, i) => (
                      <div
                        key={i}
                        className="selectable border-t border-border px-2 py-1 text-[11px] text-muted-foreground"
                      >
                        {q}
                      </div>
                    ))}
                    {row.approvals.map((a) => (
                      <div
                        key={a.toolCallId}
                        className="flex items-center gap-2 border-t border-border px-2 py-1"
                      >
                        <span className="shrink-0 font-mono text-[10px] text-amber-600 dark:text-amber-500">
                          {a.toolName}
                        </span>
                        <span
                          className="selectable min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground"
                          title={typeof a.args === 'string' ? a.args : undefined}
                        >
                          {typeof a.args === 'string' ? a.args : ''}
                        </span>
                        <Tip content="Run this tool call once — the agent continues in the background">
                          <span className="inline-flex shrink-0">
                            <Button
                              size="sm"
                              disabled={approve.isPending || !row.subchatId}
                              onClick={() =>
                                row.subchatId &&
                                approve.mutate({
                                  subchatId: row.subchatId,
                                  toolCallId: a.toolCallId,
                                  decision: 'approve'
                                })
                              }
                            >
                              Approve
                            </Button>
                          </span>
                        </Tip>
                        <Tip content="Block this tool call — the agent continues without it">
                          <span className="inline-flex shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={approve.isPending || !row.subchatId}
                              onClick={() =>
                                row.subchatId &&
                                approve.mutate({
                                  subchatId: row.subchatId,
                                  toolCallId: a.toolCallId,
                                  decision: 'decline'
                                })
                              }
                            >
                              Deny
                            </Button>
                          </span>
                        </Tip>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
