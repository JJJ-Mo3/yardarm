/**
 * Attention sub-tab of the Factory Work section: the notification inbox
 * (mentions, automation failures/proposals, waiting agents, supervisor
 * findings, activity). View toggle open/unread/archived, kind filter chips
 * fed by the server's per-kind summary, search, cursor-paged older items.
 * Receipt actions echo the server's own `kind/sourceId/occurrence` identity
 * verbatim — a 409 means the item moved on, so refresh and say so.
 */
import React, { useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  AtSign,
  Check,
  CheckCheck,
  Eye,
  Hourglass,
  Lightbulb,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  attentionSourceId,
  FACTORY_ATTENTION_KINDS,
  type FactoryAttentionItem,
  type FactoryAttentionKind,
  type FactoryAttentionView
} from '@shared/factory-work-types'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import { factoryErrorCode } from './FactoryWorkPanel'

const PAGE_SIZE = 30

const VIEWS: Array<{ id: FactoryAttentionView; label: string; tip: string }> = [
  { id: 'open', label: 'Open', tip: 'Everything not archived' },
  { id: 'unread', label: 'Unread', tip: 'Only items you have not read yet' },
  { id: 'archived', label: 'Archived', tip: 'Items you archived — restorable' }
]

const KIND_ICON: Record<FactoryAttentionKind, LucideIcon> = {
  'automation-failed': AlertTriangle,
  'agent-waiting': Hourglass,
  'automation-proposed': Lightbulb,
  mention: AtSign,
  'supervisor-finding': Eye,
  activity: Activity
}

const KIND_LABEL: Record<FactoryAttentionKind, string> = {
  'automation-failed': 'failed',
  'agent-waiting': 'waiting',
  'automation-proposed': 'proposed',
  mention: 'mentions',
  'supervisor-finding': 'findings',
  activity: 'activity'
}

function itemAge(item: FactoryAttentionItem): string | null {
  const ts = item.occurredAt ? Date.parse(item.occurredAt) : NaN
  return Number.isFinite(ts) ? timeAgo(ts) : null
}

export function FactoryAttention({
  dir,
  projectId,
  active
}: {
  dir: string
  projectId: string
  active: boolean
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const [view, setView] = useState<FactoryAttentionView>('open')
  const [kinds, setKinds] = useState<FactoryAttentionKind[]>([])
  const [search, setSearch] = useState('')
  const [older, setOlder] = useState<FactoryAttentionItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const input = {
    dir,
    projectId,
    view,
    kinds: kinds.length > 0 ? kinds : undefined,
    search: search.trim() || undefined,
    limit: PAGE_SIZE
  }
  const query = trpc.factoryWork.attention.useQuery(input, {
    enabled: active,
    refetchInterval: active ? 5000 : false,
    retry: false
  })

  const resetPaging = (): void => {
    setOlder([])
    setCursor(null)
  }
  const refresh = (): void => {
    resetPaging()
    void utils.factoryWork.attention.invalidate({ dir, projectId })
    void utils.factoryWork.attentionSummary.invalidate({ dir })
  }

  const act = trpc.factoryWork.attentionAction.useMutation({
    onSuccess: refresh,
    onError: (err) => {
      const code = factoryErrorCode(err.message)
      if (code === 'attention_item_not_current' || code === 'stale') {
        refresh()
        setNotice('That item changed underneath you — refreshed.')
      } else {
        setNotice(err.message)
      }
    }
  })
  const readAll = trpc.factoryWork.attentionReadAll.useMutation({
    onSuccess: refresh,
    onError: (err) => setNotice(err.message)
  })

  const toggleKind = (k: FactoryAttentionKind): void => {
    resetPaging()
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
  }

  const firstPage = query.data?.items ?? []
  const seen = new Set(firstPage.map((i) => i.key))
  const rows = [...firstPage, ...older.filter((i) => !seen.has(i.key))]
  const nextCursor = cursor ?? query.data?.nextCursor ?? null
  const summaries = query.data?.kinds ?? {}

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await utils.factoryWork.attention.fetch({ ...input, before: nextCursor })
      setOlder((prev) => [...prev, ...page.items])
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

  const actBtn = (
    item: FactoryAttentionItem,
    action: 'read' | 'archive' | 'restore',
    icon: React.ReactNode,
    tip: string
  ): React.JSX.Element => {
    const sourceId = attentionSourceId(item)
    return (
      <Tip content={sourceId ? tip : 'This item has no action identity — refresh and retry'}>
        <span className="inline-flex">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={!sourceId || act.isPending}
            onClick={() =>
              sourceId &&
              act.mutate({
                dir,
                projectId,
                kind: item.kind,
                sourceId,
                occurrence: item.occurrence,
                action
              })
            }
          >
            {icon}
          </Button>
        </span>
      </Tip>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-2">
        {VIEWS.map((v) => (
          <Tip key={v.id} content={v.tip} side="bottom">
            <button
              onClick={() => {
                resetPaging()
                setView(v.id)
              }}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] cursor-pointer',
                view === v.id
                  ? 'bg-accent font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {v.label}
            </button>
          </Tip>
        ))}
        <span className="h-4 w-px bg-border" />
        {FACTORY_ATTENTION_KINDS.map((k) => {
          const unread = summaries[k]?.unread ?? 0
          return (
            <Tip key={k} content={`Filter to ${k} items`} side="bottom">
              <button
                onClick={() => toggleKind(k)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] cursor-pointer',
                  kinds.includes(k)
                    ? 'border-ring bg-accent font-medium'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {KIND_LABEL[k]}
                {unread > 0 && <span className="font-medium text-sky-500">{unread}</span>}
              </button>
            </Tip>
          )
        })}
        <Tip content="Search attention items" side="bottom">
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              resetPaging()
              setSearch(e.target.value)
            }}
            className="h-6 w-36 text-[11px]"
          />
        </Tip>
        <div className="ml-auto flex items-center gap-1.5">
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
          <Tip content="Mark every attention item in this project as read">
            <span className="inline-flex">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] text-muted-foreground"
                disabled={readAll.isPending}
                onClick={() => readAll.mutate({ dir, projectId })}
              >
                <CheckCheck size={12} />
                Read all
              </Button>
            </span>
          </Tip>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {rows.map((item) => {
          const Icon = KIND_ICON[item.kind] ?? Activity
          return (
            <div
              key={item.key}
              className={cn(
                'flex items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2',
                item.read && view !== 'unread' && 'opacity-70'
              )}
            >
              <Icon
                size={14}
                className={cn(
                  'mt-0.5 shrink-0',
                  item.kind === 'automation-failed' ? 'text-red-500' : 'text-muted-foreground'
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />}
                  <span className="truncate text-[13px]">{item.title || item.kind}</span>
                  {item.decisionType && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {item.decisionType}
                    </span>
                  )}
                </div>
                {item.detail && (
                  <div
                    title={item.detail}
                    className="mt-0.5 truncate text-[11px] text-muted-foreground"
                  >
                    {item.detail}
                  </div>
                )}
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  {item.authorName && <span className="truncate">{item.authorName}</span>}
                  {itemAge(item) && <span className="shrink-0">{itemAge(item)}</span>}
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1">
                {view !== 'archived' &&
                  !item.read &&
                  actBtn(item, 'read', <Check size={12} />, 'Mark this item as read')}
                {view !== 'archived' &&
                  actBtn(item, 'archive', <Archive size={12} />, 'Archive this item')}
                {view === 'archived' &&
                  actBtn(
                    item,
                    'restore',
                    <ArchiveRestore size={12} />,
                    'Restore this item to the inbox'
                  )}
              </span>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div className="py-8 text-center text-[11px] text-muted-foreground">
            {query.isLoading ? 'Loading attention items…' : 'Nothing needs attention here'}
          </div>
        )}
        {nextCursor && rows.length > 0 && (
          <div className="flex justify-center pt-1">
            <Tip content="Load older attention items">
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
