/**
 * Intake sub-tab of the Factory Work section: external issues (GitHub,
 * Linear, ...) flowing toward the board. Two parts: source bindings (which
 * Factory project/board each integration source feeds — PUT bindings, with
 * 404/422 errors shown on the row) and the incoming items list (15s-polled
 * first page, cursor-paged older items, "Pull onto board" creates a work
 * item in the selected project carrying the item's externalSource).
 */
import React, { useState } from 'react'
import { ArrowRightToLine, Inbox, X } from 'lucide-react'
import type { FactoryIntakeItem, FactoryIntakeSource } from '@shared/factory-work-types'
import { trpc } from '../../lib/trpc'
import { timeAgo } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Tip } from '../../components/ui/tooltip'

const NONE = '__none'
const DEFAULT_BOARD = '__default'

function itemKey(item: FactoryIntakeItem): string {
  return `${item.integrationId}:${item.externalSource?.type ?? ''}:${item.externalSource?.externalId ?? item.title}`
}

function itemAge(item: FactoryIntakeItem): string | null {
  const raw = item.updatedAt ?? item.createdAt
  const ts = raw ? Date.parse(raw) : NaN
  return Number.isFinite(ts) ? timeAgo(ts) : null
}

/**
 * One source row of the bindings table. Owns its board query (boards are
 * per-project, and each row can bind to a different project) and its own
 * inline error from the last PUT.
 */
function BindingRow({
  dir,
  source,
  boundProjectId,
  boundBoard
}: {
  dir: string
  source: FactoryIntakeSource
  boundProjectId: string | null
  boundBoard: string | null
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)
  const projects = trpc.factoryWork.projects.useQuery({ dir }, { retry: false })
  const boards = trpc.factoryWork.boards.useQuery(
    { dir, projectId: boundProjectId ?? '' },
    { enabled: !!boundProjectId, retry: false }
  )
  const bind = trpc.factoryWork.setIntakeBinding.useMutation({
    onSuccess: () => {
      setError(null)
      void utils.factoryWork.intakeBindings.invalidate({ dir })
    },
    onError: (err) => setError(err.message)
  })

  const apply = (factoryProjectId: string | null, board?: string): void => {
    bind.mutate({
      dir,
      integrationId: source.integrationId,
      sourceId: source.id,
      factoryProjectId,
      board
    })
  }

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-accent px-1 font-mono text-[10px]">{source.integrationId}</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{source.name}</span>
        {source.type && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {source.type}
          </span>
        )}
        <Select
          value={boundProjectId ?? NONE}
          onValueChange={(v) => apply(v === NONE ? null : v)}
          disabled={bind.isPending}
        >
          <Tip content="Which Factory project new items from this source feed into">
            <SelectTrigger className="h-6 w-40 text-[11px]">
              <SelectValue placeholder="Not bound" />
            </SelectTrigger>
          </Tip>
          <SelectContent>
            <SelectItem value={NONE}>Not bound</SelectItem>
            {(projects.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {boundProjectId && (boards.data?.length ?? 0) > 1 && (
          <Select
            value={boundBoard ?? DEFAULT_BOARD}
            onValueChange={(v) => apply(boundProjectId, v === DEFAULT_BOARD ? undefined : v)}
            disabled={bind.isPending}
          >
            <Tip content="Which of the bound project's boards receives the items">
              <SelectTrigger className="h-6 w-36 text-[11px]">
                <SelectValue placeholder="Default board" />
              </SelectTrigger>
            </Tip>
            <SelectContent>
              <SelectItem value={DEFAULT_BOARD}>Default board</SelectItem>
              {(boards.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {error && <div className="selectable mt-1 text-[11px] text-destructive">{error}</div>}
    </div>
  )
}

export function FactoryIntake({
  dir,
  projectId,
  active
}: {
  dir: string
  projectId: string
  active: boolean
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const [older, setOlder] = useState<FactoryIntakeItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const items = trpc.factoryWork.intakeItems.useQuery(
    { dir },
    { enabled: active, refetchInterval: active ? 15_000 : false, retry: false }
  )
  const sources = trpc.factoryWork.intakeSources.useQuery(
    { dir },
    { enabled: active, retry: false }
  )
  const bindings = trpc.factoryWork.intakeBindings.useQuery(
    { dir },
    { enabled: active, retry: false }
  )
  const boards = trpc.factoryWork.boards.useQuery(
    { dir, projectId },
    { enabled: active, retry: false }
  )

  const pull = trpc.factoryWork.createWorkItem.useMutation({
    onSuccess: () => {
      void utils.factoryWork.workItems.invalidate({ dir, projectId })
      setNotice('Pulled onto the board — see the Board tab.')
    },
    onError: (err) => setNotice(err.message)
  })

  const firstPage = items.data?.items ?? []
  const seen = new Set(firstPage.map(itemKey))
  const rows = [...firstPage, ...older.filter((i) => !seen.has(itemKey(i)))]
  const nextCursor = cursor ?? items.data?.nextCursor ?? null
  const failures = [...(items.data?.failures ?? []), ...(sources.data?.failures ?? [])]
  const failedIntegrations = [...new Set(failures.map((f) => f.integrationId))]

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await utils.factoryWork.intakeItems.fetch({ dir, cursor: nextCursor })
      setOlder((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor ?? null)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingMore(false)
    }
  }

  if (items.error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {items.error.message}
      </div>
    )
  }

  const bindingFor = (s: FactoryIntakeSource) =>
    (bindings.data ?? []).find((b) => b.integrationId === s.integrationId && b.sourceId === s.id)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        {(notice || failedIntegrations.length > 0) && (
          <div className="flex flex-col gap-1">
            {failedIntegrations.length > 0 && (
              <div className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
                Some integrations failed to load: {failedIntegrations.join(', ')}
              </div>
            )}
            {notice && (
              <div className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
                <span className="selectable min-w-0 flex-1 truncate">{notice}</span>
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
        )}

        <div className="space-y-1.5">
          <div className="text-xs font-medium">Source bindings</div>
          <div className="text-[11px] text-muted-foreground">
            Bind each integration source to a Factory project so its new items land on that
            project&apos;s board automatically. Integrations themselves are configured in the
            Factory dashboard (Server section).
          </div>
          {(sources.data?.sources ?? []).map((s) => {
            const b = bindingFor(s)
            return (
              <BindingRow
                key={`${s.integrationId}:${s.id}`}
                dir={dir}
                source={s}
                boundProjectId={b?.factoryProjectId ?? null}
                boundBoard={b?.board ?? null}
              />
            )
          })}
          {(sources.data?.sources ?? []).length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
              {sources.isLoading
                ? 'Loading sources…'
                : sources.error
                  ? sources.error.message
                  : 'No intake sources — connect GitHub, Linear, or Slack in the Factory dashboard first.'}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium">Incoming items</div>
          {rows.map((item) => (
            <div
              key={itemKey(item)}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <Inbox size={13} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{item.title}</div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  {item.externalSource?.type && (
                    <span className="rounded bg-accent px-1">{item.externalSource.type}</span>
                  )}
                  {item.status && <span>{item.status}</span>}
                  {item.assignee && <span className="truncate">{item.assignee}</span>}
                  {itemAge(item) && <span>{itemAge(item)}</span>}
                </div>
              </div>
              <Tip content="Create a work item for this issue on the selected project's board">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-muted-foreground"
                    disabled={pull.isPending}
                    onClick={() =>
                      pull.mutate({
                        dir,
                        projectId,
                        title: item.title,
                        board: boards.data?.[0]?.id,
                        externalSource: item.externalSource
                      })
                    }
                  >
                    <ArrowRightToLine size={12} />
                    Pull onto board
                  </Button>
                </span>
              </Tip>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
              {items.isLoading ? 'Loading intake items…' : 'No incoming items right now'}
            </div>
          )}
          {nextCursor && rows.length > 0 && (
            <div className="flex justify-center pt-1">
              <Tip content="Load older intake items">
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
    </div>
  )
}
