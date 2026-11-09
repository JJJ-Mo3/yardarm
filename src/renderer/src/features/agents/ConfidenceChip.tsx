/**
 * Header/plan-card chip for the agent's self-reported confidence marker
 * (CONFIDENCE: green|yellow|red — reason). Renders nothing when no marker
 * has been emitted; the reason lives in the tooltip.
 */
import React from 'react'
import { Gauge } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'
import type { ConfidenceInfo } from '../../../../shared/confidence'

const LEVEL_STYLES: Record<ConfidenceInfo['level'], string> = {
  green: 'border-green-600/40 bg-green-500/10 text-green-500',
  yellow: 'border-amber-600/40 bg-amber-500/10 text-amber-500',
  red: 'border-red-600/40 bg-red-500/10 text-red-500'
}

const LEVEL_HINTS: Record<ConfidenceInfo['level'], string> = {
  green: 'the agent believes requirements and approach are clear',
  yellow: 'the agent sees some uncertainty — consider answering its questions',
  red: 'the agent sees significant unknowns — clarify before letting it proceed'
}

export function ConfidenceChip({
  confidence,
  className
}: {
  confidence: ConfidenceInfo
  className?: string
}): React.JSX.Element {
  const { level, reason } = confidence
  return (
    <Tip
      content={`Agent confidence: ${level}${reason ? ` — ${reason}` : ''} (${LEVEL_HINTS[level]})`}
      side="bottom"
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px]',
          LEVEL_STYLES[level],
          className
        )}
      >
        <Gauge size={10} />
        {level}
      </span>
    </Tip>
  )
}
