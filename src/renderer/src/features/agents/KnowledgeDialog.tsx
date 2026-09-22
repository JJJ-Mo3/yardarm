/**
 * /knowledge browser: two-pane dialog over the SDK's Subconscious knowledge
 * inspector. Left pane picks a scope (org/resource/thread) and lists nodes;
 * right pane shows the selected node's content, records and related nodes.
 * Read-only — knowledge is written by the agent's memory subsystem.
 */
import React, { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Tip } from '../../components/ui/tooltip'
import { Markdown } from './Markdown'
import { timeAgo } from '../../lib/utils'
import type { KnowledgeRecordInfo, KnowledgeScopeLevel } from '@shared/ipc-types'

const SCOPE_LABELS: Record<KnowledgeScopeLevel, string> = {
  org: 'Organization',
  resource: 'Resource',
  thread: 'Thread'
}

function RecordList({ records }: { records: KnowledgeRecordInfo[] }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      {records.map((r, i) => (
        <div key={i} className="rounded border border-border px-2 py-1.5">
          <div className="whitespace-pre-wrap text-[11px]">{r.text}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {timeAgo(Date.parse(r.capturedAt))}
            {r.when ? ` · ${r.when}` : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

export function KnowledgeDialog({
  subchatId,
  open,
  onOpenChange
}: {
  subchatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [scope, setScope] = useState<KnowledgeScopeLevel>('resource')
  const [selected, setSelected] = useState<string | null>(null)

  const list = trpc.agent.knowledgeList.useQuery(
    { subchatId, scope },
    { enabled: open && !!subchatId, retry: false }
  )
  const detail = trpc.agent.knowledgeGet.useQuery(
    { subchatId, id: selected ?? '' },
    { enabled: open && !!subchatId && !!selected, retry: false }
  )

  // Reset the selection when the dialog reopens or the scope changes.
  useEffect(() => {
    setSelected(null)
  }, [open, scope])

  const entries = list.data?.entries ?? []
  const unavailable =
    list.data && (!list.data.available || list.data.unavailableReason)
      ? (list.data.unavailableReason ?? 'Knowledge is unavailable in this workspace.')
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="flex items-center gap-1.5">
          <BookOpen size={14} />
          Knowledge
        </DialogTitle>
        <div className="flex h-[26rem] gap-3">
          <div className="flex w-56 shrink-0 flex-col gap-2">
            <Tip content="Knowledge scope to browse (organization, resource, or this thread)">
              <span className="inline-flex">
                <Select value={scope} onValueChange={(v) => setScope(v as KnowledgeScopeLevel)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['org', 'resource', 'thread'] as const).map((level) => {
                      const info = list.data?.scopes.find((s) => s.level === level)
                      return (
                        <SelectItem key={level} value={level} disabled={info?.available === false}>
                          {SCOPE_LABELS[level]}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </span>
            </Tip>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {list.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
              {list.error && (
                <div className="text-[11px] text-red-500">
                  Failed to load knowledge: {list.error.message}
                </div>
              )}
              {unavailable && (
                <div className="text-[11px] text-muted-foreground">{unavailable}</div>
              )}
              {!unavailable && list.data && entries.length === 0 && !list.isLoading && (
                <div className="text-[11px] text-muted-foreground">
                  No knowledge nodes in this scope yet. The agent captures knowledge as it works.
                </div>
              )}
              {entries.map((e) => (
                <button
                  key={e.handle}
                  onClick={() => setSelected(e.handle)}
                  className={`block w-full rounded border px-2 py-1.5 text-left cursor-pointer ${
                    selected === e.handle
                      ? 'border-primary/50 bg-accent'
                      : 'border-border hover:bg-accent/50'
                  }`}
                >
                  <div className="truncate text-[11px] font-medium" title={e.name}>
                    {e.name}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {e.kind ? `${e.kind} · ` : ''}
                    {timeAgo(Date.parse(e.updatedAt))}
                    {typeof e.records === 'number' ? ` · ${e.records} records` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto rounded border border-border p-3">
            {!selected && (
              <div className="text-[11px] text-muted-foreground">
                Select a knowledge node to see its content, records, and related nodes.
              </div>
            )}
            {selected && detail.isLoading && (
              <div className="text-[11px] text-muted-foreground">Loading…</div>
            )}
            {selected && detail.error && (
              <div className="text-[11px] text-red-500">
                Failed to load node: {detail.error.message}
              </div>
            )}
            {selected && detail.data && (
              <div className="space-y-3">
                {detail.data.unavailableReason && (
                  <div className="text-[11px] text-muted-foreground">
                    {detail.data.unavailableReason}
                  </div>
                )}
                {detail.data.entry && (
                  <div>
                    <div className="text-xs font-medium">{detail.data.entry.name}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {detail.data.entry.kind ? `${detail.data.entry.kind} · ` : ''}
                      {SCOPE_LABELS[detail.data.entry.scopeLevel]} scope ·{' '}
                      {timeAgo(Date.parse(detail.data.entry.updatedAt))}
                    </div>
                  </div>
                )}
                {detail.data.content && (
                  <div>
                    <Markdown text={detail.data.content} />
                    {detail.data.contentTruncated && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Content truncated.
                      </div>
                    )}
                  </div>
                )}
                {detail.data.records.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium">Records</div>
                    <RecordList records={detail.data.records} />
                  </div>
                )}
                {detail.data.mentioning.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium">Mentioned by</div>
                    <RecordList records={detail.data.mentioning} />
                  </div>
                )}
                {detail.data.related.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium">Related nodes</div>
                    <div className="flex flex-wrap gap-1">
                      {detail.data.related.map((rel) => (
                        <Tip key={rel.handle} content={`Open ${rel.name}`}>
                          <button
                            onClick={() => setSelected(rel.handle)}
                            className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            {rel.name}
                          </button>
                        </Tip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
