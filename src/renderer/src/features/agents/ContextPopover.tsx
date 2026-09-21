/**
 * Header popover showing the /context audit: what is occupying the context
 * window (instructions, skills, tool definitions, conversation, observation
 * memory), grouped into startup vs accumulated shares. Data comes from the
 * agent host's contextUsage command, which mirrors the CLI's /context.
 */
import React from 'react'
import { PieChart } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Tip } from '../../components/ui/tooltip'
import type { ContextUsageGroup } from '../../../../shared/ipc-types'

function formatTokens(tokens: number): string {
  return Intl.NumberFormat().format(tokens)
}

function formatPercent(percent: number): string {
  if (percent > 0 && percent < 0.1) return '<0.1%'
  return `${percent.toFixed(1)}%`
}

/** Collapse a group's entries when one source dominates (CLI parity for tools). */
function groupRows(group: ContextUsageGroup): { label: string; tokens: number }[] {
  const byDetail = new Map<string, { tokens: number; count: number }>()
  for (const entry of group.entries) {
    const key = entry.detail ?? entry.label
    const existing = byDetail.get(key) ?? { tokens: 0, count: 0 }
    byDetail.set(key, { tokens: existing.tokens + entry.tokens, count: existing.count + 1 })
  }
  const rows =
    group.id === 'tools' && group.entries.length > byDetail.size
      ? [...byDetail.entries()].map(([detail, agg]) => ({
          label: `${detail} (${agg.count} tool${agg.count === 1 ? '' : 's'})`,
          tokens: agg.tokens
        }))
      : group.entries.map((entry) => ({ label: entry.detail ?? entry.label, tokens: entry.tokens }))
  return rows.sort((a, b) => b.tokens - a.tokens)
}

function GroupBlock({ group }: { group: ContextUsageGroup }): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate">{group.label}</span>
        <span className="shrink-0 font-mono">
          {formatTokens(group.tokens)}
          <span className="ml-1.5 text-muted-foreground">{formatPercent(group.percent)}</span>
        </span>
      </div>
      <div className="mt-0.5 space-y-0.5">
        {groupRows(group).map((row, i) => (
          <div
            key={`${row.label}-${i}`}
            className="flex items-center justify-between gap-2 pl-3 text-[11px]"
          >
            <span className="truncate text-muted-foreground" title={row.label}>
              {row.label}
            </span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {formatTokens(row.tokens)}
            </span>
          </div>
        ))}
        {group.note && <div className="pl-3 text-[10px] text-muted-foreground">{group.note}</div>}
      </div>
    </div>
  )
}

function Section({
  title,
  tokens,
  percent,
  groups
}: {
  title: string
  tokens: number
  percent: number
  groups: ContextUsageGroup[]
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium">
        <span>{title}</span>
        <span className="font-mono text-[11px]">
          {formatTokens(tokens)}
          <span className="ml-1.5 font-sans text-muted-foreground">{formatPercent(percent)}</span>
        </span>
      </div>
      <div className="space-y-1.5">
        {groups.map((g) => (
          <GroupBlock key={g.id} group={g} />
        ))}
      </div>
    </div>
  )
}

export function ContextPopover({
  subchatId,
  open,
  onOpenChange
}: {
  subchatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const audit = trpc.agent.contextUsage.useQuery(
    { subchatId },
    { enabled: open, staleTime: 15_000, retry: false }
  )
  const data = audit.data
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tip content="Audit what is using the context window (/context)">
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer">
            <PieChart size={11} />
            context
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-1.5 text-xs font-medium">
          Context audit
          {data && (
            <span className="ml-1.5 font-mono font-normal text-muted-foreground">
              ~{formatTokens(data.totalTokens)} tok
            </span>
          )}
        </div>
        {audit.isLoading && (
          <div className="text-[11px] text-muted-foreground">Auditing context…</div>
        )}
        {audit.error && (
          <div className="text-[11px] text-red-500">
            Failed to audit context: {audit.error.message}
          </div>
        )}
        {data && (
          <div className="max-h-80 space-y-3 overflow-y-auto">
            <Section
              title="Startup context"
              tokens={data.startup.tokens}
              percent={data.startup.percent}
              groups={data.startup.groups}
            />
            {data.accumulated.groups.length > 0 && (
              <Section
                title="Accumulated"
                tokens={data.accumulated.tokens}
                percent={data.accumulated.percent}
                groups={data.accumulated.groups}
              />
            )}
          </div>
        )}
        <div className="mt-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
          Token counts are estimates; percentages are shares of the audited total, not of the model
          context window.
        </div>
      </PopoverContent>
    </Popover>
  )
}
