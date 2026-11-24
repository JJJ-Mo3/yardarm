/**
 * Cross-chat search dialog (⌘K → "Search all chats…", `/search`, or its own
 * shortcut): full-text search over the user/assistant message text of every
 * chat in every project. Results show a highlighted excerpt with project,
 * chat title and age; choosing one opens that chat and hands the matched
 * message to the in-chat find bar, which highlights and scrolls to it.
 */
import React, { useEffect, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useAtom, useSetAtom } from 'jotai'
import { Bot, Loader2, Search, User } from 'lucide-react'
import { highlightTerm, splitSnippet, SEARCH_MAX_INPUT } from '@shared/message-search'
import { trpc } from '../../lib/trpc'
import { chatSearchAtom, messageJumpAtom } from '../../lib/atoms'
import { useOpenChat } from '../../lib/use-open-chat'
import { cn, timeAgo } from '../../lib/utils'

export function ChatSearchDialog(): React.JSX.Element {
  const [state, setState] = useAtom(chatSearchAtom)
  const setJump = useSetAtom(messageJumpAtom)
  const openChat = useOpenChat()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Fresh state on every open, seeded by `/search <text>` when given.
  useEffect(() => {
    if (state.open) {
      setQuery(state.query)
      setDebounced(state.query)
      setActive(0)
    }
  }, [state.open, state.query])

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 160)
    return () => clearTimeout(timer)
  }, [query])

  const search = trpc.search.messages.useQuery(
    { query: debounced },
    {
      enabled: state.open && debounced.trim().length > 0,
      placeholderData: (prev) => prev,
      // Older messages are indexed in the background on first use — keep
      // refreshing until the backfill is done so results fill in.
      refetchInterval: (q) => (q.state.data?.indexing ? 1500 : false)
    }
  )
  const hits = debounced.trim() ? (search.data?.hits ?? []) : []
  const clamped = Math.min(active, Math.max(0, hits.length - 1))

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${clamped}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [clamped])

  const close = (): void => setState({ open: false, query: '' })
  const choose = (i: number): void => {
    const hit = hits[i]
    if (!hit) return
    close()
    openChat({ projectId: hit.projectId, chatId: hit.chatId, subchatId: hit.subchatId })
    const jump = {
      subchatId: hit.subchatId,
      messageId: hit.messageId,
      term: highlightTerm(debounced)
    }
    setJump(jump)
    // Drop an unconsumed request (chat failed to open) so it can't fire later.
    setTimeout(() => setJump((cur) => (cur === jump ? null : cur)), 8000)
  }

  return (
    <DialogPrimitive.Root open={state.open} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14%] z-50 w-full max-w-2xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-background shadow-xl focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Search all chats</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Full-text search over message text across every chat and project
          </DialogPrimitive.Description>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              maxLength={SEARCH_MAX_INPUT}
              aria-label="Search all chats"
              placeholder="Search messages across all chats…"
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (hits.length === 0) return
                  const dir = e.key === 'ArrowDown' ? 1 : -1
                  setActive((clamped + dir + hits.length) % hits.length)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  choose(clamped)
                }
              }}
              className="h-10 w-full bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground"
            />
            {search.isFetching && (
              <Loader2 size={13} className="shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>
          {search.data?.indexing && debounced.trim() && (
            <div className="border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
              Indexing older messages — results may be incomplete for a moment.
            </div>
          )}
          {search.error && (
            <div className="selectable border-b border-border px-3 py-1 text-xs text-destructive">
              Search failed: {search.error.message}
            </div>
          )}
          <div
            ref={listRef}
            role="listbox"
            aria-label="Matching messages"
            className="max-h-[26rem] overflow-y-auto p-1.5"
          >
            {hits.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                {!debounced.trim()
                  ? 'Type to search the text of your and the agent’s messages in every chat.'
                  : search.isFetching
                    ? 'Searching…'
                    : 'No matching messages'}
              </div>
            )}
            {hits.map((hit, i) => (
              <div
                key={hit.messageId}
                role="option"
                aria-selected={i === clamped}
                data-index={i}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(i)}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5',
                  i === clamped && 'bg-accent'
                )}
              >
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {hit.role === 'user' ? <User size={13} /> : <Bot size={13} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 break-words text-[12px]">
                    {splitSnippet(hit.snippet).map((seg, j) =>
                      seg.hit ? (
                        <mark
                          key={j}
                          className="rounded-sm bg-amber-400/30 px-0.5 text-foreground dark:bg-amber-400/25"
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={j}>{seg.text}</span>
                      )
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="max-w-[35%] truncate" title={hit.projectName}>
                      {hit.projectName}
                    </span>
                    <span>·</span>
                    <span className="min-w-0 flex-1 truncate" title={hit.chatTitle}>
                      {hit.chatTitle}
                      {hit.chatArchived ? ' (archived)' : ''}
                    </span>
                    <span className="shrink-0">{timeAgo(hit.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
