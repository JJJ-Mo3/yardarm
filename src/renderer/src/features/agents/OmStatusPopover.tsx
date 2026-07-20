/**
 * Observational Memory status + runtime config (/om). Reads OM fields from
 * live session state, lets you change models/thresholds, and shows recent
 * om_* progress events from the stream.
 */
import React, { useEffect, useState } from 'react'
import { Brain } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Tip } from '../../components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import type { OmProgressInfo } from '../../../../shared/ui-message'

function ThresholdField({
  value,
  disabled,
  onCommit
}: {
  value: number | undefined
  disabled?: boolean
  onCommit: (n: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    // Live session-state refreshes shouldn't clobber an in-progress edit.
    if (!focused) setDraft(value != null ? String(value) : '')
  }, [value, focused])
  const commit = (): void => {
    // Min 1000: the SDK sizes its OM buffer at 20% of the threshold, so tiny
    // values make Memory validation throw on every message.
    const n = Math.round(Number(draft))
    if (Number.isFinite(n) && n > 0) {
      const clamped = Math.max(n, 1000)
      if (clamped !== value) {
        onCommit(clamped)
        setDraft(String(clamped))
        return
      }
    }
    setDraft(value != null ? String(value) : '')
  }
  return (
    <Input
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      className="h-6 w-24 font-mono text-[11px]"
    />
  )
}

function summarizeEvent(ev: OmProgressInfo): string {
  const parts = Object.entries(ev.data)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .slice(0, 3)
    .map(([k, v]) => `${k}=${String(v)}`)
  return parts.join(' ')
}

export function OmStatusPopover({
  subchatId,
  omEvents,
  open,
  onOpenChange
}: {
  subchatId: string
  omEvents: OmProgressInfo[]
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const om = trpc.agent.omGet.useQuery({ subchatId }, { enabled: open })
  const models = trpc.agent.listModels.useQuery(
    { subchatId },
    { enabled: open, staleTime: 60_000 }
  )
  const omSet = trpc.agent.omSet.useMutation({
    onSuccess: (info) => utils.agent.omGet.setData({ subchatId }, info)
  })

  const info = om.data
  const busy = omSet.isPending

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tip content="Observational Memory — the agent's long-term memory of this project; click to view status and tune models/thresholds (/om)">
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer">
            <Brain size={11} />
            om
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-80">
        <div className="mb-1.5 text-xs font-medium">Observational Memory</div>
        {om.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
        {om.error && (
          <div className="text-[11px] text-destructive selectable">{om.error.message}</div>
        )}
        {info && (
          <div className="space-y-2">
            {(['observerModelId', 'reflectorModelId'] as const).map((field) => (
              <div key={field} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {field === 'observerModelId' ? 'Observer model' : 'Reflector model'}
                </span>
                <Select
                  value={info[field] ?? ''}
                  disabled={busy}
                  onValueChange={(v) => omSet.mutate({ subchatId, patch: { [field]: v } })}
                >
                  <Tip
                    content={
                      field === 'observerModelId'
                        ? 'Model that watches the conversation and records observations'
                        : 'Model that condenses accumulated observations into reflections'
                    }
                  >
                    <SelectTrigger className="h-6 max-w-44 text-[11px]">
                      <SelectValue placeholder="default" />
                    </SelectTrigger>
                  </Tip>
                  <SelectContent>
                    {(models.data ?? [])
                      .filter((m) => m.hasApiKey)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.id}
                        </SelectItem>
                      ))}
                    {info[field] &&
                      !(models.data ?? []).some((m) => m.hasApiKey && m.id === info[field]) && (
                        <SelectItem value={info[field]} disabled>
                          {info[field]} (no key)
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Observation threshold</span>
              <Tip content="Token count that triggers an observation pass (minimum 1000)">
                <span className="inline-flex">
                  <ThresholdField
                    value={info.observationThreshold}
                    disabled={busy}
                    onCommit={(n) => omSet.mutate({ subchatId, patch: { observationThreshold: n } })}
                  />
                </span>
              </Tip>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Reflection threshold</span>
              <Tip content="Observation token count that triggers a reflection pass (minimum 1000)">
                <span className="inline-flex">
                  <ThresholdField
                    value={info.reflectionThreshold}
                    disabled={busy}
                    onCommit={(n) => omSet.mutate({ subchatId, patch: { reflectionThreshold: n } })}
                  />
                </span>
              </Tip>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Caveman observations</span>
              <Tip content="Store observations in terse shorthand to use fewer tokens">
                <span className="inline-flex">
                  <Switch
                    checked={info.cavemanObservations ?? false}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      omSet.mutate({ subchatId, patch: { cavemanObservations: v } })
                    }
                  />
                </span>
              </Tip>
            </div>
            {info.omScope && (
              <div className="text-[10px] text-muted-foreground">scope: {info.omScope}</div>
            )}
          </div>
        )}
        {omSet.error && (
          <div className="mt-1 text-[11px] text-destructive selectable">{omSet.error.message}</div>
        )}
        <div className="mt-2 border-t border-border pt-1.5">
          <div className="mb-1 text-[10px] font-medium text-muted-foreground">Recent activity</div>
          {omEvents.length === 0 ? (
            <div className="text-[10px] text-muted-foreground">No OM events this session.</div>
          ) : (
            <div className="max-h-32 space-y-0.5 overflow-y-auto">
              {omEvents
                .slice(-8)
                .reverse()
                .map((ev, i) => (
                  <div key={`${ev.ts}-${i}`} className="truncate font-mono text-[10px] selectable">
                    <span className="text-muted-foreground">
                      {new Date(ev.ts).toLocaleTimeString()}
                    </span>{' '}
                    {ev.kind} {summarizeEvent(ev)}
                  </div>
                ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
