/**
 * Decisions sub-tab of the Factory Work section: the human approval gates.
 * Filterable by status (pending + proposed by default), first page polled;
 * older pages load on demand via the server cursor. Approve / Dismiss act on
 * pending or proposed decisions; Retry only on failed ones the server marks
 * retryable — a 409 means the decision moved on, so refresh and say so.
 */
import React, { useState } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'
import {
  FACTORY_DECISION_STATUSES,
  type FactoryDecision,
  type FactoryDecisionStatus
} from '@shared/factory-work-types'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { factoryErrorCode } from './FactoryWorkPanel'

const PAGE_SIZE = 30
const DEFAULT_STATUSES: FactoryDecisionStatus[] = ['pending', 'proposed']

const STATUS_BADGE: Partial<Record<FactoryDecisionStatus, string>> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  proposed: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  succeeded: 'bg-green-500/15 text-green-600 dark:text-green-400'
}

function ago(d: FactoryDecision): string | null {
  const raw = d.updatedAt ?? d.createdAt
  const ts = raw ? Date.parse(raw) : NaN
  return Number.isFinite(ts) ? timeAgo(ts) : null
}

export function FactoryDecisions({
  dir,
  projectId,
  active
}: {
  dir: string
  projectId: string
  active: boolean
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const [statuses, setStatuses] = useState<FactoryDecisionStatus[]>(DEFAULT_STATUSES)
  const [older, setOlder] = useState<FactoryDecision[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const query = trpc.factoryWork.decisions.useQuery(
    { dir, projectId, statuses, limit: PAGE_SIZE },
    { enabled: active, refetchInterval: active ? 5000 : false, retry: false }
  )
  const work = trpc.factoryWork.workItems.useQuery(
    { dir, projectId },
    { enabled: active, retry: false }
  )
  const titles = new Map((work.data?.workItems ?? []).map((w) => [w.id, w.title]))

  const refresh = (): void => {
    setOlder([])
    setCursor(null)
    void utils.factoryWork.decisions.invalidate({ dir, projectId })
  }
  const act = trpc.factoryWork.decisionAction.useMutation({
    onSuccess: refresh,
    onError: (err) => {
      const code = factoryErrorCode(err.message)
      if (
        code === 'decision_not_retryable' ||
        code === 'decision_not_proposed' ||
        code === 'stale'
      ) {
        refresh()
        setNotice('That decision changed underneath you — refreshed.')
      } else {
        setNotice(err.message)
      }
    }
  })

  const toggleStatus = (s: FactoryDecisionStatus): void => {
    setOlder([])
    setCursor(null)
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  const firstPage = query.data?.decisions ?? []
  const seen = new Set(firstPage.map((d) => d.id))
  const rows = [...firstPage, ...older.filter((d) => !seen.has(d.id))]
  const nextCursor = cursor ?? query.data?.nextCursor ?? null

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await utils.factoryWork.decisions.fetch({
        dir,
        projectId,
        statuses,
        before: nextCursor,
        limit: PAGE_SIZE
      })
      setOlder((prev) => [...prev, ...page.decisions])
      setCursor(page.nextCursor ?? null)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingMore(false)
    }
  }

  if (query.error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {query.error.message}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-2">
        {FACTORY_DECISION_STATUSES.map((s) => (
          <Tip key={s} content={`Show ${s} decisions`} side="bottom">
            <button
              onClick={() => toggleStatus(s)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] cursor-pointer',
                statuses.includes(s)
                  ? 'border-ring bg-accent font-medium'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {s}
            </button>
          </Tip>
        ))}
        {notice && (
          <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
            <span className="selectable truncate">{notice}</span>
            <Tip content="Dismiss this notice">
              <button
                className="cursor-pointer hover:text-foreground"
                onClick={() => setNotice(null)}
              >
                <X size={11} />
              </button>
            </Tip>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {rows.map((d) => {
          const canActPending = d.status === 'pending' || d.status === 'proposed'
          const canRetry = d.status === 'failed' && !!d.canRetry
          const title = d.workItemId ? (titles.get(d.workItemId) ?? d.workItemId) : null
          return (
            <div key={d.id} className="rounded-md border border-border bg-card px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge
                  className={cn('text-[10px]', STATUS_BADGE[d.status] ?? 'text-muted-foreground')}
                >
                  {d.status}
                </Badge>
                <span className="truncate text-[13px]">{d.type ?? 'decision'}</span>
                {d.role && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {d.role}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {canActPending && (
                    <>
                      <Tip content="Approve this decision — the automation proceeds">
                        <span className="inline-flex">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate({ dir, projectId, decisionId: d.id, action: 'approve' })
                            }
                          >
                            <Check size={12} />
                          </Button>
                        </span>
                      </Tip>
                      <Tip content="Dismiss this decision — the proposed action is dropped">
                        <span className="inline-flex">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate({ dir, projectId, decisionId: d.id, action: 'dismiss' })
                            }
                          >
                            <X size={12} />
                          </Button>
                        </span>
                      </Tip>
                    </>
                  )}
                  {canRetry && (
                    <Tip content="Retry this failed automation">
                      <span className="inline-flex">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          disabled={act.isPending}
                          onClick={() =>
                            act.mutate({ dir, projectId, decisionId: d.id, action: 'retry' })
                          }
                        >
                          <RotateCcw size={12} />
                        </Button>
                      </span>
                    </Tip>
                  )}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                {title && (
                  <span title={d.workItemId ?? undefined} className="truncate">
                    {title}
                  </span>
                )}
                {typeof d.attempts === 'number' && d.attempts > 0 && (
                  <span className="shrink-0">
                    {d.attempts} attempt{d.attempts === 1 ? '' : 's'}
                  </span>
                )}
                {ago(d) && <span className="shrink-0">{ago(d)}</span>}
                {d.lastError && (
                  <Tip content={expanded === d.id ? 'Hide the error' : 'Show the full error'}>
                    <button
                      className="shrink-0 cursor-pointer text-red-500 hover:underline"
                      onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                    >
                      error
                    </button>
                  </Tip>
                )}
              </div>
              {expanded === d.id && d.lastError && (
                <div className="selectable mt-1 rounded bg-red-500/10 px-2 py-1 font-mono text-[10px] text-red-600 dark:text-red-400">
                  {d.lastError}
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <div className="py-8 text-center text-[11px] text-muted-foreground">
            {query.isLoading
              ? 'Loading decisions…'
              : statuses.length === 0
                ? 'Pick at least one status filter'
                : 'No decisions match these filters'}
          </div>
        )}
        {nextCursor && rows.length > 0 && (
          <div className="flex justify-center pt-1">
            <Tip content="Load older decisions">
              <span className="inline-flex">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </span>
            </Tip>
          </div>
        )}
      </div>
    </div>
  )
}
