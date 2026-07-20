/**
 * Color-coded segmented control for the agent mode (plan / build / fast).
 * Shows an optimistic pending state (pulse) while a mode switch is in flight.
 */
import React from 'react'
import { ClipboardList, Hammer, Zap, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'
import { MODES, type Mode } from '../../../../shared/ui-message'

const MODE_META: Record<Mode, { icon: LucideIcon; tip: string; active: string }> = {
  plan: {
    icon: ClipboardList,
    tip: 'Plan mode — read-only research; the agent proposes a plan for your approval before touching files',
    active: 'bg-blue-500/15 text-blue-400 border-blue-500/40'
  },
  build: {
    icon: Hammer,
    tip: 'Build mode — the agent edits files and runs tools to do the work',
    active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
  },
  fast: {
    icon: Zap,
    tip: 'Fast mode — quicker, lighter responses for small tasks',
    active: 'bg-amber-500/15 text-amber-400 border-amber-500/40'
  }
}

export function ModeSelector({
  value,
  pending,
  onChange
}: {
  value: Mode
  /** Mode a switch is in flight to, or null when settled. */
  pending: Mode | null
  onChange: (mode: Mode) => void
}): React.JSX.Element {
  const shown = pending ?? value
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {MODES.map((m) => {
        const info = MODE_META[m]
        const Icon = info.icon
        return (
          <Tip key={m} content={info.tip} side="bottom">
            <button
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded border border-transparent px-2 py-1 text-[11px] capitalize',
                m === shown ? info.active : 'text-muted-foreground hover:text-foreground',
                m === pending && 'animate-pulse opacity-70'
              )}
              onClick={() => onChange(m)}
            >
              <Icon size={11} />
              {m}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}
