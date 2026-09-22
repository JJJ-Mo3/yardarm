/**
 * Minimal command-palette primitive (cmdk-style): a top-anchored dialog with
 * a filter input and a grouped, keyboard-navigable action list. Purely
 * presentational — callers supply a flat action list (group members must be
 * contiguous); the filter matches every whitespace-separated query token as a
 * substring of the action's label, keywords and group.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Search } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface CommandAction {
  id: string
  /** Group header the action is listed under. */
  group: string
  label: string
  icon?: React.ReactNode
  /** Dimmed right-aligned detail (description, shortcut hint). */
  detail?: string
  /** Extra text the filter matches against. */
  keywords?: string
  onSelect: () => void
}

function matches(action: CommandAction, tokens: string[]): boolean {
  const haystack = `${action.label} ${action.keywords ?? ''} ${action.group}`.toLowerCase()
  return tokens.every((t) => haystack.includes(t))
}

export function CommandDialog({
  open,
  onOpenChange,
  actions,
  placeholder
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: CommandAction[]
  placeholder: string
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Fresh state on every open.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    return tokens.length === 0 ? actions : actions.filter((a) => matches(a, tokens))
  }, [actions, query])
  const clamped = Math.min(active, Math.max(0, filtered.length - 1))

  const select = (action: CommandAction): void => {
    onOpenChange(false)
    action.onSelect()
  }

  // Keep the active row visible while arrowing through the list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${clamped}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [clamped])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[18%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-background shadow-xl focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              placeholder={placeholder}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (filtered.length === 0) return
                  const dir = e.key === 'ArrowDown' ? 1 : -1
                  setActive((clamped + dir + filtered.length) % filtered.length)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const action = filtered[clamped]
                  if (action) select(action)
                }
              }}
              className="h-10 w-full bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label="Commands"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {filtered.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">No matches</div>
            )}
            {filtered.map((a, i) => (
              <React.Fragment key={a.id}>
                {(i === 0 || filtered[i - 1].group !== a.group) && (
                  <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {a.group}
                  </div>
                )}
                <div
                  role="option"
                  aria-selected={i === clamped}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => select(a)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px]',
                    i === clamped && 'bg-accent'
                  )}
                >
                  {a.icon && <span className="shrink-0 text-muted-foreground">{a.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  {a.detail && (
                    <span className="max-w-[45%] truncate text-[11px] text-muted-foreground">
                      {a.detail}
                    </span>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
