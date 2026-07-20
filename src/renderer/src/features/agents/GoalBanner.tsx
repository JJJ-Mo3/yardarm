/**
 * Active-goal banner (/goal). Shows the thread's objective, judge, run
 * progress and the latest evaluation; clears via the X button.
 */
import React, { useEffect } from 'react'
import { Pause, Play, Target, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'
import type { GoalEvaluationInfo } from '../../../../shared/ui-message'

const STATUS_STYLES: Record<string, string> = {
  active: 'text-blue-400',
  paused: 'text-amber-500',
  done: 'text-green-500'
}

export function GoalBanner({
  subchatId,
  live
}: {
  subchatId: string
  /** Latest goal_evaluation from the event stream, if any. */
  live: GoalEvaluationInfo | null
}): React.JSX.Element | null {
  const utils = trpc.useUtils()
  const goal = trpc.agent.goalGet.useQuery({ subchatId })
  const goalClear = trpc.agent.goalClear.useMutation({
    onSuccess: () => utils.agent.goalGet.invalidate({ subchatId })
  })
  const goalUpdate = trpc.agent.goalUpdate.useMutation({
    onSuccess: () => utils.agent.goalGet.invalidate({ subchatId })
  })

  // Each judge evaluation updates runsUsed/status server-side; refresh.
  useEffect(() => {
    if (live) void utils.agent.goalGet.invalidate({ subchatId })
  }, [live, subchatId, utils])

  const g = goal.data
  if (!g) return null

  return (
    <div className="flex items-start gap-2 border-b border-border bg-accent/30 px-4 py-1.5">
      <Target size={12} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] selectable">
          <span className="font-medium">Goal:</span> {g.objective}
        </div>
        <div className="text-[10px] text-muted-foreground selectable">
          <span className={cn('font-medium', STATUS_STYLES[g.status])}>{g.status}</span>
          {' · '}run {g.runsUsed}
          {g.maxRuns ? `/${g.maxRuns}` : ''}
          {g.judgeModelId ? ` · judge ${g.judgeModelId}` : ''}
          {g.pausedReason ? ` · paused: ${g.pausedReason}` : ''}
          {live?.reason
            ? ` · last eval: ${live.passed ? 'passed' : 'not yet'} — ${live.reason}`
            : ''}
        </div>
      </div>
      {g.status !== 'done' && (
        <Tip
          content={
            g.status === 'paused'
              ? 'Resume this goal — the judge evaluates runs against it again'
              : 'Pause this goal — the judge stops evaluating until you resume'
          }
        >
          <span className="inline-flex">
            <button
              disabled={goalUpdate.isPending}
              onClick={() =>
                goalUpdate.mutate({
                  subchatId,
                  status: g.status === 'paused' ? 'active' : 'paused'
                })
              }
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {g.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}
            </button>
          </span>
        </Tip>
      )}
      <Tip content="Clear this goal — the judge stops evaluating runs against it">
        <span className="inline-flex">
          <button
            disabled={goalClear.isPending}
            onClick={() => goalClear.mutate({ subchatId })}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X size={12} />
          </button>
        </span>
      </Tip>
    </div>
  )
}
