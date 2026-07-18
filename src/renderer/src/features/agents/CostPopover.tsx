import React from 'react'
import { Coins } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import type { UsageInfo } from '../../../../shared/ui-message'

const KNOWN_LABELS: Record<string, string> = {
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  totalTokens: 'Total tokens',
  reasoningTokens: 'Reasoning tokens',
  cachedInputTokens: 'Cached input tokens'
}

export function CostPopover({
  subchatId,
  usage,
  open,
  onOpenChange
}: {
  subchatId: string
  usage: UsageInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const entries = Object.entries(usage ?? {}).filter(
    (e): e is [string, number] => typeof e[1] === 'number'
  )
  const threads = trpc.agent.listThreads.useQuery({ subchatId }, { enabled: open })
  const threadRows = (threads.data ?? []).filter((t) => (t.totalTokens ?? 0) > 0)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          title="Token usage (/cost)"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Coins size={11} />
          {usage?.totalTokens != null
            ? `${Intl.NumberFormat().format(usage.totalTokens)} tok`
            : 'usage'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <div className="mb-1.5 text-xs font-medium">Session usage</div>
        {entries.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No usage recorded yet.</div>
        ) : (
          <div className="space-y-1">
            {entries.map(([key, val]) => (
              <div key={key} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{KNOWN_LABELS[key] ?? key}</span>
                <span className="font-mono">{Intl.NumberFormat().format(val)}</span>
              </div>
            ))}
          </div>
        )}
        {threadRows.length > 0 && (
          <>
            <div className="mt-3 mb-1.5 text-xs font-medium">Per thread</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {threadRows.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-muted-foreground">
                    {t.active ? '● ' : ''}
                    {t.title || t.preview || t.id.slice(0, 8)}
                  </span>
                  <span className="shrink-0 font-mono">
                    {Intl.NumberFormat().format(t.totalTokens ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mt-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
          Session usage is cumulative since the agent process started.
        </div>
      </PopoverContent>
    </Popover>
  )
}
