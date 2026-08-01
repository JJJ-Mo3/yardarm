/**
 * Analytics tab: token usage for the selected project, aggregated from
 * per-message usage persisted by the agent session manager. Usage is recorded
 * from migration v6 onward, so older messages don't count. No dollar figures —
 * actual prices vary by provider/plan, so only tokens are reported, plus the
 * tokens saved by the compression subsystem.
 */
import React, { useState } from 'react'
import { Download } from 'lucide-react'
import { trpc } from '../../lib/trpc'
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
  const [exportError, setExportError] = useState<string | null>(null)
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
      return acc
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  )

  const exportCsv = async (): Promise<void> => {
    setExportError(null)
    try {
      const csv = await utils.analytics.exportCsv.fetch(input)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `yardarm-usage-${days}d.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">Token usage</div>
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

        {exportError && (
          <div className="text-xs text-destructive selectable">
            CSV export failed: {exportError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard label="Total tokens" value={nf.format(totals.totalTokens)} />
          <SummaryCard label="Input tokens" value={nf.format(totals.inputTokens)} />
          <SummaryCard label="Output tokens" value={nf.format(totals.outputTokens)} />
          <SummaryCard
            label="Compression saved"
            value={nf.format(compression.data?.tokensSaved ?? 0)}
            hint="tokens avoided by compression"
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
              <span className="text-right">Total</span>
            </div>
            {(byModel.data ?? []).map((r) => (
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
                <span className="text-right font-mono">{nf.format(r.totalTokens)}</span>
              </div>
            ))}
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
      </div>
    </div>
  )
}
