/**
 * Goal control popover (/goal). Set a judge-evaluated objective for the
 * thread, watch its progress, pause/resume it, tune the judge model and run
 * limit, or clear it — no slash command needed.
 */
import React, { useEffect, useState } from 'react'
import { Pause, Pencil, Play, Target, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Tip } from '../../components/ui/tooltip'
import { ModelSelect } from '../../components/ModelSelect'
import type { GoalEvaluationInfo } from '../../../../shared/ui-message'

const STATUS_STYLES: Record<string, string> = {
  active: 'text-blue-400',
  paused: 'text-amber-500',
  done: 'text-green-500'
}

/** Small max-runs field that commits on blur/Enter (positive integers only). */
function MaxRunsField({
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
    if (!focused) setDraft(value != null ? String(value) : '')
  }, [value, focused])
  const commit = (): void => {
    const n = Math.round(Number(draft))
    if (Number.isFinite(n) && n > 0 && n !== value) {
      onCommit(n)
      setDraft(String(n))
      return
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
      className="h-6 w-16 font-mono text-[11px]"
    />
  )
}

export function GoalPopover({
  subchatId,
  live,
  open,
  onOpenChange
}: {
  subchatId: string
  /** Latest goal_evaluation from the event stream, if any. */
  live: GoalEvaluationInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  // Ungated: the trigger reflects goal state (shares the cache key with GoalBanner).
  const goal = trpc.agent.goalGet.useQuery({ subchatId })
  const models = trpc.agent.listModels.useQuery({ subchatId }, { enabled: open, staleTime: 60_000 })
  const invalidate = (): void => {
    void utils.agent.goalGet.invalidate({ subchatId })
  }
  const goalSet = trpc.agent.goalSet.useMutation({ onSuccess: invalidate })
  const goalUpdate = trpc.agent.goalUpdate.useMutation({ onSuccess: invalidate })
  const goalClear = trpc.agent.goalClear.useMutation({ onSuccess: invalidate })

  // New-goal form state.
  const [objective, setObjective] = useState('')
  const [judge, setJudge] = useState('')
  const [maxRuns, setMaxRuns] = useState('')
  // Editing state for an existing goal's objective.
  const [editing, setEditing] = useState(false)

  // Each judge evaluation updates runsUsed/status server-side; refresh.
  useEffect(() => {
    if (live) void utils.agent.goalGet.invalidate({ subchatId })
  }, [live, subchatId, utils])

  useEffect(() => {
    // Reset transient form state whenever the popover closes or the chat changes.
    setEditing(false)
    setObjective('')
  }, [open, subchatId])

  const g = goal.data
  const busy = goalSet.isPending || goalUpdate.isPending || goalClear.isPending
  const mutationError = goalSet.error ?? goalUpdate.error ?? goalClear.error

  const submitNew = (): void => {
    const text = objective.trim()
    if (!text) return
    const n = Math.round(Number(maxRuns))
    goalSet.mutate({
      subchatId,
      objective: text,
      judgeModelId: judge || undefined,
      maxRuns: Number.isFinite(n) && n > 0 ? n : undefined
    })
    setObjective('')
  }

  const submitEdit = (): void => {
    if (!g) return
    const text = objective.trim()
    if (!text) return
    // setObjective creates a fresh record (run count restarts); keep judge/limit.
    goalSet.mutate({
      subchatId,
      objective: text,
      judgeModelId: g.judgeModelId,
      maxRuns: g.maxRuns
    })
    setEditing(false)
    setObjective('')
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tip content="Goal — give the agent an objective a judge model evaluates after each run; click to set or manage it (/goal)">
        <PopoverTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-1 text-[10px] cursor-pointer',
              g ? STATUS_STYLES[g.status] : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Target size={11} />
            goal
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-80">
        <div className="mb-1.5 text-xs font-medium">Goal</div>
        {goal.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
        {goal.error && (
          <div className="text-[11px] text-destructive selectable">{goal.error.message}</div>
        )}

        {!goal.isLoading && !g && (
          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground">
              Set an objective and a judge model evaluates each run against it, telling the agent to
              keep going until the goal is met.
            </div>
            <textarea
              value={objective}
              disabled={busy}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Objective, e.g. all tests pass and the feature works end to end"
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[11px] focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Judge model</span>
              <Tip content="Model that judges whether each run met the objective — defaults to your settings, then this chat's model">
                <span className="inline-flex max-w-44">
                  <ModelSelect
                    value={judge}
                    onChange={setJudge}
                    models={models.data ?? []}
                    placeholder="default"
                  />
                </span>
              </Tip>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Max runs</span>
              <Tip content="Stop judging after this many runs — leave empty for the default">
                <span className="inline-flex">
                  <Input
                    value={maxRuns}
                    disabled={busy}
                    onChange={(e) => setMaxRuns(e.target.value)}
                    placeholder="default"
                    className="h-6 w-16 font-mono text-[11px]"
                  />
                </span>
              </Tip>
            </div>
            <Tip content="Set this goal — the judge starts evaluating runs against it">
              <span className="inline-flex w-full">
                <button
                  disabled={busy || !objective.trim()}
                  onClick={submitNew}
                  className="w-full rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50 cursor-pointer"
                >
                  Set goal
                </button>
              </span>
            </Tip>
          </div>
        )}

        {g && (
          <div className="space-y-2">
            {editing ? (
              <div className="space-y-1.5">
                <textarea
                  value={objective}
                  disabled={busy}
                  onChange={(e) => setObjective(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[11px] focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <Tip content="Replace the objective — this restarts the goal's run count">
                    <span className="inline-flex">
                      <button
                        disabled={busy || !objective.trim()}
                        onClick={submitEdit}
                        className="rounded-md border border-border bg-accent/40 px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50 cursor-pointer"
                      >
                        Save
                      </button>
                    </span>
                  </Tip>
                  <Tip content="Keep the current objective">
                    <button
                      onClick={() => setEditing(false)}
                      className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent cursor-pointer"
                    >
                      Cancel
                    </button>
                  </Tip>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1 text-[11px] selectable">{g.objective}</div>
                <Tip content="Edit the objective — saving restarts the goal's run count">
                  <button
                    onClick={() => {
                      setObjective(g.objective)
                      setEditing(true)
                    }}
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <Pencil size={11} />
                  </button>
                </Tip>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground selectable">
              <span className={cn('font-medium', STATUS_STYLES[g.status])}>{g.status}</span>
              {' · '}run {g.runsUsed}
              {g.maxRuns ? `/${g.maxRuns}` : ''}
              {g.pausedReason ? ` · paused: ${g.pausedReason}` : ''}
              {live?.reason
                ? ` · last eval: ${live.passed ? 'passed' : 'not yet'} — ${live.reason}`
                : ''}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Judge model</span>
              <Tip content="Model that judges whether each run met the objective">
                <span className="inline-flex max-w-44">
                  <ModelSelect
                    value={g.judgeModelId ?? ''}
                    onChange={(v) => {
                      if (v) goalUpdate.mutate({ subchatId, judgeModelId: v })
                    }}
                    models={models.data ?? []}
                    placeholder="default"
                  />
                </span>
              </Tip>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Max runs</span>
              <Tip content="Stop judging after this many runs">
                <span className="inline-flex">
                  <MaxRunsField
                    value={g.maxRuns}
                    disabled={busy}
                    onCommit={(n) => goalUpdate.mutate({ subchatId, maxRuns: n })}
                  />
                </span>
              </Tip>
            </div>
            <div className="flex gap-1.5">
              {g.status === 'paused' ? (
                <Tip content="Resume this goal — the judge evaluates runs against it again">
                  <span className="inline-flex">
                    <button
                      disabled={busy}
                      onClick={() => goalUpdate.mutate({ subchatId, status: 'active' })}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50 cursor-pointer"
                    >
                      <Play size={11} />
                      Resume
                    </button>
                  </span>
                </Tip>
              ) : (
                <Tip content="Pause this goal — the judge stops evaluating until you resume">
                  <span className="inline-flex">
                    <button
                      disabled={busy || g.status === 'done'}
                      onClick={() => goalUpdate.mutate({ subchatId, status: 'paused' })}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50 cursor-pointer"
                    >
                      <Pause size={11} />
                      Pause
                    </button>
                  </span>
                </Tip>
              )}
              <Tip content="Clear this goal — the judge stops evaluating runs against it">
                <span className="inline-flex">
                  <button
                    disabled={busy}
                    onClick={() => goalClear.mutate({ subchatId })}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50 cursor-pointer"
                  >
                    <X size={11} />
                    Clear
                  </button>
                </span>
              </Tip>
            </div>
          </div>
        )}

        {mutationError && (
          <div className="mt-1 text-[11px] text-destructive selectable">
            {mutationError.message}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
