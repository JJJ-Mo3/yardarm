/**
 * Compact single-line rendering of a passive tool call in the transcript:
 * tool icon + verb-based title (shimmering while the tool runs) + optional
 * diff stats / count suffix, expandable to a per-tool details view. This
 * replaces the old bordered ToolCallCard so long agent turns scan like a
 * log. Interactive tools (ask_user, submit_plan, request_access) never
 * reach this component — MessageList routes them to their cards.
 */
import React, { useMemo, useState } from 'react'
import { ChevronRight, PauseCircle, ShieldQuestion } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { Tip } from '../../../components/ui/tooltip'
import { TextShimmer } from '../../../components/ui/text-shimmer'
import type { ToolCallPart } from '../../../../../shared/ui-message'
import { asRecord } from '../ToolArgsView'
import { getToolDescriptor, phaseOf } from './registry'

export function ToolCallRow({ part }: { part: ToolCallPart }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const desc = getToolDescriptor(part.toolName)
  const phase = phaseOf(part.status)
  const args = useMemo(() => asRecord(part.args), [part.args])
  const title = useMemo(() => desc.title(part, args, phase), [desc, part, args, phase])
  const stats = useMemo(() => desc.stats(args), [desc, args])
  const Icon = desc.icon
  const live = phase === 'pending' || phase === 'waiting'

  return (
    <div className="my-0.5 text-xs">
      <Tip content={open ? 'Hide the details of this tool call' : "Show this tool call's details"}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left cursor-pointer hover:bg-accent/50"
        >
          <Icon
            size={13}
            className={cn(
              'shrink-0',
              phase === 'failed' ? 'text-destructive' : 'text-muted-foreground'
            )}
          />
          {live ? (
            <TextShimmer className={cn('truncate', title.mono && 'font-mono text-[11px]')}>
              {title.text}
            </TextShimmer>
          ) : (
            <span
              className={cn(
                'truncate',
                title.mono ? 'font-mono text-[11px]' : 'text-foreground/90',
                phase === 'failed' && 'text-destructive'
              )}
            >
              {title.text}
            </span>
          )}
          {stats && (stats.added > 0 || stats.removed > 0) && (
            <span className="shrink-0 font-mono text-[11px]">
              {stats.added > 0 && <span className="text-green-500">+{stats.added}</span>}
              {stats.added > 0 && stats.removed > 0 && ' '}
              {stats.removed > 0 && <span className="text-destructive">−{stats.removed}</span>}
            </span>
          )}
          {title.suffix && (
            <span className="shrink-0 text-[11px] text-muted-foreground">{title.suffix}</span>
          )}
          {part.status === 'awaiting-approval' && (
            <ShieldQuestion size={12} className="shrink-0 text-amber-500" />
          )}
          {part.status === 'suspended' && (
            <PauseCircle size={12} className="shrink-0 text-amber-500" />
          )}
          <ChevronRight
            size={11}
            className={cn(
              'shrink-0 text-muted-foreground transition-transform',
              open ? 'rotate-90' : 'opacity-0 group-hover:opacity-100'
            )}
          />
        </button>
      </Tip>
      {open && (
        <div className="ml-[26px] mt-1 mb-1.5 selectable">
          <desc.Details part={part} />
        </div>
      )}
    </div>
  )
}
