/**
 * Scheduled runs manager (Devin-style scheduled sessions): recurring prompts
 * the main-process scheduler fires into a dedicated per-schedule chat while
 * Yardarm is open. Distinct from the SDK's experimental in-agent schedule_*
 * tools, which live inside a single agent process and die with it. Opened
 * via /schedules or the chat header's ⋯ menu.
 */
import React, { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { selectedProjectIdAtom } from '../../lib/atoms'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { timeAgo } from '../../lib/utils'
import {
  describeCadence,
  parseCadence,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  WEEKDAY_NAMES,
  type ScheduleCadence
} from '@shared/schedules'

interface FormState {
  name: string
  prompt: string
  kind: ScheduleCadence['kind']
  minutes: string
  hour: string
  minute: string
  day: string
  useWorktree: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  prompt: '',
  kind: 'daily',
  minutes: '60',
  hour: '9',
  minute: '0',
  day: '1',
  useWorktree: false
}

const KIND_LABELS: Record<ScheduleCadence['kind'], string> = {
  interval: 'Every N minutes',
  daily: 'Daily',
  weekly: 'Weekly'
}

const KIND_TIPS: Record<ScheduleCadence['kind'], string> = {
  interval: `Fire on a fixed interval (${MIN_INTERVAL_MINUTES} minutes to 7 days)`,
  daily: 'Fire once a day at a local wall-clock time',
  weekly: 'Fire once a week on a chosen weekday and time'
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', label: 'ok' },
  error: { dot: 'bg-red-500', label: 'error' },
  skipped: { dot: 'bg-amber-500', label: 'skipped — chat was busy' }
}

/** Compact countdown for a future epoch-ms timestamp ("in 3m", "in 2h 10m"). */
function formatUntil(ts: number): string {
  const delta = ts - Date.now()
  if (delta <= 0) return 'due'
  const m = Math.ceil(delta / 60_000)
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 === 0 ? `in ${h}h` : `in ${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return h % 24 === 0 ? `in ${d}d` : `in ${d}d ${h % 24}h`
}

function cadenceFromForm(f: FormState): ScheduleCadence | null {
  const int = (s: string): number | null => {
    const n = Number(s)
    return s.trim() !== '' && Number.isInteger(n) ? n : null
  }
  if (f.kind === 'interval') {
    const minutes = int(f.minutes)
    if (minutes === null || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
      return null
    }
    return { kind: 'interval', minutes }
  }
  const hour = int(f.hour)
  const minute = int(f.minute)
  if (hour === null || hour < 0 || hour > 23) return null
  if (minute === null || minute < 0 || minute > 59) return null
  if (f.kind === 'daily') return { kind: 'daily', hour, minute }
  const day = int(f.day)
  if (day === null || day < 0 || day > 6) return null
  return { kind: 'weekly', day, hour, minute }
}

function formFromCadence(name: string, prompt: string, cadence: ScheduleCadence | null): FormState {
  const base: FormState = { ...EMPTY_FORM, name, prompt }
  if (!cadence) return base
  if (cadence.kind === 'interval') {
    return { ...base, kind: 'interval', minutes: String(cadence.minutes) }
  }
  if (cadence.kind === 'daily') {
    return { ...base, kind: 'daily', hour: String(cadence.hour), minute: String(cadence.minute) }
  }
  return {
    ...base,
    kind: 'weekly',
    day: String(cadence.day),
    hour: String(cadence.hour),
    minute: String(cadence.minute)
  }
}

export function SchedulesDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const projectId = useAtomValue(selectedProjectIdAtom)
  const utils = trpc.useUtils()
  // 30s refetch keeps the next-run countdowns and last-run dots fresh.
  const list = trpc.schedules.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: open && !!projectId, refetchInterval: open ? 30_000 : false }
  )
  const invalidate = (): void => {
    utils.schedules.list.invalidate()
  }
  const create = trpc.schedules.create.useMutation({ onSuccess: invalidate })
  const update = trpc.schedules.update.useMutation({ onSuccess: invalidate })
  const setEnabled = trpc.schedules.setEnabled.useMutation({ onSuccess: invalidate })
  const remove = trpc.schedules.delete.useMutation({ onSuccess: invalidate })
  const runNow = trpc.schedules.runNow.useMutation({ onSuccess: invalidate })

  // null = list view; 'new' = create form; otherwise the schedule id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  useEffect(() => {
    if (!open) setEditing(null)
  }, [open])

  const rows = list.data ?? []
  const mutationError =
    create.error ?? update.error ?? setEnabled.error ?? remove.error ?? runNow.error
  const cadence = cadenceFromForm(form)
  const formValid = cadence !== null && form.name.trim() !== '' && form.prompt.trim() !== ''

  const submit = (): void => {
    if (!cadence || !formValid || !projectId) return
    const common = { name: form.name.trim(), prompt: form.prompt.trim(), cadence }
    if (editing === 'new') {
      create.mutate(
        { projectId, useWorktree: form.useWorktree, ...common },
        { onSuccess: () => setEditing(null) }
      )
    } else if (editing) {
      update.mutate({ id: editing, ...common }, { onSuccess: () => setEditing(null) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle className="flex items-center gap-1.5">
          <CalendarClock size={14} />
          Scheduled runs
        </DialogTitle>
        <div className="flex max-h-[26rem] min-h-[14rem] flex-col gap-2 overflow-y-auto">
          {mutationError && <div className="text-[11px] text-red-500">{mutationError.message}</div>}
          {editing !== null ? (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Name</div>
                <Input
                  value={form.name}
                  maxLength={100}
                  placeholder="Nightly dependency check"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">
                  Prompt sent to the agent on each run
                </div>
                <Textarea
                  rows={4}
                  value={form.prompt}
                  placeholder="e.g. Run the test suite and summarize any failures."
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Cadence</div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded border text-[11px]">
                    {(['interval', 'daily', 'weekly'] as const).map((k) => (
                      <Tip key={k} content={KIND_TIPS[k]} side="bottom">
                        <button
                          className={`px-2 py-1 cursor-pointer ${
                            form.kind === k
                              ? 'bg-secondary text-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          onClick={() => setForm({ ...form, kind: k })}
                        >
                          {KIND_LABELS[k]}
                        </button>
                      </Tip>
                    ))}
                  </div>
                  {form.kind === 'interval' && (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      every
                      <Input
                        type="number"
                        className="w-20"
                        min={MIN_INTERVAL_MINUTES}
                        max={MAX_INTERVAL_MINUTES}
                        value={form.minutes}
                        onChange={(e) => setForm({ ...form, minutes: e.target.value })}
                      />
                      minutes ({MIN_INTERVAL_MINUTES}–{MAX_INTERVAL_MINUTES})
                    </span>
                  )}
                  {form.kind === 'weekly' && (
                    <Tip content="Weekday the schedule fires on">
                      <span className="inline-flex">
                        <Select
                          value={form.day}
                          onValueChange={(v) => setForm({ ...form, day: v })}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WEEKDAY_NAMES.map((n, i) => (
                              <SelectItem key={n} value={String(i)}>
                                {n}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </span>
                    </Tip>
                  )}
                  {form.kind !== 'interval' && (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      at
                      <Input
                        type="number"
                        className="w-16"
                        min={0}
                        max={23}
                        value={form.hour}
                        onChange={(e) => setForm({ ...form, hour: e.target.value })}
                      />
                      :
                      <Input
                        type="number"
                        className="w-16"
                        min={0}
                        max={59}
                        value={form.minute}
                        onChange={(e) => setForm({ ...form, minute: e.target.value })}
                      />
                      (local time)
                    </span>
                  )}
                </div>
              </div>
              {editing === 'new' && (
                <div className="flex items-center gap-2">
                  <Tip content="Run the schedule's chat in its own isolated git worktree — suits recurring tasks that make changes">
                    <span className="inline-flex">
                      <Switch
                        checked={form.useWorktree}
                        onCheckedChange={(v) => setForm({ ...form, useWorktree: v })}
                      />
                    </span>
                  </Tip>
                  <span className="text-[11px] text-muted-foreground">
                    Run in an isolated worktree
                  </span>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <Tip content="Back to the schedule list without saving">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </Tip>
                <Tip
                  content={
                    formValid
                      ? editing === 'new'
                        ? 'Create the schedule — the first run is computed from now'
                        : 'Save changes — a cadence change re-anchors the next run to now'
                      : 'Fill in a name, a prompt, and a valid cadence first'
                  }
                >
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      disabled={!formValid || create.isPending || update.isPending}
                      onClick={submit}
                    >
                      {editing === 'new' ? 'Create schedule' : 'Save changes'}
                    </Button>
                  </span>
                </Tip>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">
                  Recurring prompts for this project, each in its own “Schedule: …” chat.
                </div>
                <Tip content="Create a new recurring agent run">
                  <span className="inline-flex">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!projectId}
                      onClick={() => {
                        setForm(EMPTY_FORM)
                        setEditing('new')
                      }}
                    >
                      <Plus size={12} />
                      New schedule
                    </Button>
                  </span>
                </Tip>
              </div>
              {list.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
              {list.error && (
                <div className="text-[11px] text-red-500">
                  Failed to load schedules: {list.error.message}
                </div>
              )}
              {list.data && rows.length === 0 && (
                <div className="text-[11px] text-muted-foreground">
                  No schedules yet. Create one to have the agent run a prompt on a cadence — nightly
                  test runs, dependency checks, log triage…
                </div>
              )}
              {rows.map((row) => {
                const rowCadence = parseCadence(row.cadence)
                const status = row.lastRunStatus ? STATUS_STYLES[row.lastRunStatus] : undefined
                return (
                  <div key={row.id} className="rounded border border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium" title={row.name}>
                          {row.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span>
                            {rowCadence ? describeCadence(rowCadence) : 'invalid cadence'}
                          </span>
                          {row.enabled && row.nextRunAt !== null && (
                            <span>next {formatUntil(row.nextRunAt)}</span>
                          )}
                          {!row.enabled && <span>disabled</span>}
                          {status && row.lastRunAt !== null && (
                            <span className="flex items-center gap-1">
                              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                              {status.label} {timeAgo(row.lastRunAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <Tip
                        content={
                          row.enabled
                            ? 'Disable — stops firing until re-enabled'
                            : 'Enable — the next run is computed from now'
                        }
                      >
                        <span className="inline-flex">
                          <Switch
                            checked={row.enabled}
                            onCheckedChange={(v) => setEnabled.mutate({ id: row.id, enabled: v })}
                          />
                        </span>
                      </Tip>
                      <Tip content="Run now — fires immediately without moving the next scheduled run (skipped if the chat is busy)">
                        <span className="inline-flex">
                          <button
                            className="flex items-center text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                            disabled={runNow.isPending}
                            onClick={() => runNow.mutate({ id: row.id })}
                          >
                            <Play size={13} />
                          </button>
                        </span>
                      </Tip>
                      <Tip content="Edit this schedule's name, prompt, or cadence">
                        <button
                          className="flex items-center text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() => {
                            setForm(
                              formFromCadence(row.name, row.prompt, parseCadence(row.cadence))
                            )
                            setEditing(row.id)
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                      </Tip>
                      <Tip content="Delete this schedule (its chat and history stay)">
                        <button
                          className="flex items-center text-muted-foreground hover:text-red-500 cursor-pointer"
                          onClick={() => remove.mutate({ id: row.id })}
                        >
                          <Trash2 size={13} />
                        </button>
                      </Tip>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Schedules fire only while Yardarm is open; an overdue schedule fires once at launch, then
          re-anchors. Distinct from the SDK&apos;s experimental in-agent schedule_* tools, which
          live inside a single agent process.
        </div>
      </DialogContent>
    </Dialog>
  )
}
