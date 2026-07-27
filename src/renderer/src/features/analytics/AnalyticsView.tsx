/**
 * Analytics tab: token usage and estimated cost for the selected project,
 * aggregated from per-message usage persisted by the agent session manager.
 * Usage is recorded from migration v6 onward, so older messages don't count.
 */
import React, { useState } from 'react'
import { Download } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { estimateCostUSD } from '../../../../shared/model-prices'
import { BarChart } from '../../components/ui/bar-chart'
import { Button } from '../../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Tip } from '../../components/ui/tooltip'

const nf = Intl.NumberFormat()

function fmtCost(v: number): string {
  return `$${v.toFixed(v >= 100 ? 0 : 2)}`
}

function SummaryCard({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function AnalyticsView({ projectId }: { projectId: string }): React.JSX.Element {
  const [days, setDays] = useState(30)
  const input = { projectId, days }
  const byDay = trpc.analytics.usageByDay.useQuery(input)
  const byModel = trpc.analytics.usageByModel.useQuery(input)
  const byChat = trpc.analytics.usageByChat.useQuery(input)
  const compression = trpc.analytics.compressionSavings.useQuery(input)
  const utils = trpc.useUtils()

  const totals = (byModel.data ?? []).reduce(
    (acc, r) => {
      acc.inputTokens += r.inputTokens
      acc.outputTokens += r.outputTokens
      acc.totalTokens += r.totalTokens
      const cost = estimateCostUSD(r.modelId, r)
      if (cost == null) acc.unknownModels += 1
      else acc.costUSD += cost
      return acc
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0, unknownModels: 0 }
  )

  const exportCsv = async (): Promise<void> => {
    const csv = await utils.analytics.exportCsv.fetch(input)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `yardarm-usage-${days}d.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">Usage &amp; cost</div>
          <div className="ml-auto flex items-center gap-2">
            <Tip content="Time period for all figures on this page">
              <span className="inline-flex">
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </span>
            </Tip>
            <Tip content="Download a day-by-model usage breakdown as CSV">
              <span className="inline-flex">
                <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
                  <Download size={13} />
                  Export CSV
                </Button>
              </span>
            </Tip>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard label="Total tokens" value={nf.format(totals.totalTokens)} />
          <SummaryCard label="Input tokens" value={nf.format(totals.inputTokens)} />
          <SummaryCard label="Output tokens" value={nf.format(totals.outputTokens)} />
          <SummaryCard
            label="Est. cost"
            value={fmtCost(totals.costUSD)}
            hint={
              totals.unknownModels > 0
                ? `${totals.unknownModels} model${totals.unknownModels > 1 ? 's' : ''} unpriced`
                : 'static price estimates'
            }
          />
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium">Tokens per day</div>
          <BarChart
            data={(byDay.data ?? []).map((d) => ({ label: d.day, value: d.totalTokens }))}
          />
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium">By model</div>
          <div className="rounded-lg border border-border">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Model</span>
              <span className="text-right">Msgs</span>
              <span className="text-right">Input</span>
              <span className="text-right">Output</span>
              <span className="text-right">Est. cost</span>
            </div>
            {(byModel.data ?? []).map((r) => {
              const cost = estimateCostUSD(r.modelId, r)
              return (
                <div
                  key={r.modelId}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-t border-border px-3 py-1.5 text-[11px]"
                >
                  <span className="truncate" title={r.modelId}>
                    {r.modelId}
                  </span>
                  <span className="text-right font-mono">{nf.format(r.messages)}</span>
                  <span className="text-right font-mono">{nf.format(r.inputTokens)}</span>
                  <span className="text-right font-mono">{nf.format(r.outputTokens)}</span>
                  <span className="text-right font-mono">{cost == null ? '—' : fmtCost(cost)}</span>
                </div>
              )
            })}
            {(byModel.data ?? []).length === 0 && (
              <div className="border-t border-border px-3 py-3 text-[11px] text-muted-foreground">
                No usage recorded in this period. Per-message usage is recorded for new agent turns
                going forward.
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium">By chat</div>
          <div className="rounded-lg border border-border">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Chat</span>
              <span className="text-right">Input</span>
              <span className="text-right">Output</span>
              <span className="text-right">Total</span>
            </div>
            {(byChat.data ?? []).map((r) => (
              <div
                key={r.chatId}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-t border-border px-3 py-1.5 text-[11px]"
              >
                <span className="truncate" title={r.title}>
                  {r.title}
                </span>
                <span className="text-right font-mono">{nf.format(r.inputTokens)}</span>
                <span className="text-right font-mono">{nf.format(r.outputTokens)}</span>
                <span className="text-right font-mono">{nf.format(r.totalTokens)}</span>
              </div>
            ))}
            {(byChat.data ?? []).length === 0 && (
              <div className="border-t border-border px-3 py-3 text-[11px] text-muted-foreground">
                No usage recorded in this period.
              </div>
            )}
          </div>
        </div>

        <div className="text-[10px] leading-4 text-muted-foreground">
          Costs are rough estimates from a static price table; local models (Ollama, LM Studio,
          llama.cpp) count as free.
          {(compression.data?.tokensSaved ?? 0) > 0 && (
            <>
              {' '}
              Token compression saved about{' '}
              <span className="font-mono text-green-600 dark:text-green-500">
                {nf.format(compression.data!.tokensSaved)}
              </span>{' '}
              tokens in this period.
            </>
          )}
        </div>
      </div>
    </div>
  )
}
