/**
 * Shared searchable model picker (settings/onboarding/chat header). Renders a
 * select-like trigger that opens a popover with a filter input and a
 * scrollable listbox of usable models (hasApiKey) instead of hundreds of
 * disabled "(no key)" entries; if the current value is no longer usable it
 * stays visible as a single disabled "(no key)" row so existing selections
 * aren't silently lost.
 */
import React, { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'
import { Tip } from './ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Input } from './ui/input'

export function ModelSelect({
  value,
  onChange,
  models,
  placeholder,
  tip,
  className
}: {
  value: string
  onChange: (v: string) => void
  models: Array<{ id: string; hasApiKey: boolean }>
  placeholder: string
  /** Tooltip for the trigger; defaults to a generic picker hint. */
  tip?: string
  /** Extra classes for the trigger button (e.g. width overrides). */
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const usable = models.filter((m) => m.hasApiKey)
  const currentUnusable = value && !usable.some((m) => m.id === value) ? value : null
  const filtered = usable.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()))
  const pick = (v: string): void => {
    onChange(v)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setFilter('')
      }}
    >
      <Tip content={tip ?? 'Pick a model — type to filter the list'}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'flex h-7 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px]',
              className
            )}
          >
            <span
              className={cn('min-w-0 flex-1 truncate text-left', !value && 'text-muted-foreground')}
              title={value || undefined}
            >
              {value ? (currentUnusable ? `${value} (no key)` : value) : placeholder}
            </span>
            <ChevronDown size={12} className="shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="w-72 p-1" align="start">
        <Input
          autoFocus
          placeholder="Filter models"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered.length > 0) pick(filtered[0].id)
          }}
          className="mb-1 h-7 text-[11px]"
        />
        <div className="max-h-56 overflow-y-auto">
          <button
            onClick={() => pick('')}
            className="block w-full cursor-pointer rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
          >
            {placeholder}
          </button>
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => pick(m.id)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-accent',
                value === m.id && 'text-primary'
              )}
            >
              <span className="min-w-0 flex-1 truncate" title={m.id}>
                {m.id}
              </span>
              {value === m.id && <Check size={11} className="shrink-0" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">No matching models</div>
          )}
          {currentUnusable && (
            <div
              className="truncate px-2 py-1 font-mono text-[11px] text-muted-foreground"
              title={currentUnusable}
            >
              {currentUnusable} (no key)
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
