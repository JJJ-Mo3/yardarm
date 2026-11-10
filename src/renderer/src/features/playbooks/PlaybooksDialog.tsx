/**
 * Playbooks manager (/playbooks or ⋯ → Playbooks): Yardarm-managed run-books
 * over workflows stored by the agent SDK. A playbook names a stored workflow,
 * carries a description and default JSON input, and runs through the active
 * chat's agent host — with a form derived from the workflow's input schema
 * when it is flat, or a raw-JSON fallback otherwise. Create here from an
 * existing workflow, or hand a description to the agent to draft one.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { BookOpenCheck, Pencil, Play, Plus, Sparkles, Trash2 } from 'lucide-react'
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
import { useConfirm } from '../../components/ConfirmDialog'
import { timeAgo } from '../../lib/utils'
import { parseInputFields } from './input-schema'

type View = { kind: 'list' } | { kind: 'edit'; id: string | null } | { kind: 'run'; id: string }

interface FormState {
  name: string
  description: string
  workflowId: string
  defaultInputJson: string
}

const EMPTY_FORM: FormState = { name: '', description: '', workflowId: '', defaultInputJson: '' }

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', label: 'ok' },
  error: { dot: 'bg-red-500', label: 'error' }
}

/** Empty string = valid "no input"; otherwise must parse to a JSON object. */
function jsonObjectError(text: string): string | null {
  if (!text.trim()) return null
  try {
    const v = JSON.parse(text)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'Must be a JSON object.'
    return null
  } catch {
    return 'Not valid JSON yet — fix the syntax first.'
  }
}

export function PlaybooksDialog({
  open,
  onOpenChange,
  subchatId,
  onDraftWithAgent
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Active chat's subchat — workflow storage is read via its agent host. */
  subchatId: string | null
  /** Sends a workflow-drafting prompt to the active chat. */
  onDraftWithAgent: (description: string) => void
}): React.JSX.Element {
  const projectId = useAtomValue(selectedProjectIdAtom)
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const list = trpc.playbooks.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: open && !!projectId }
  )
  const workflows = trpc.projectConfig.workflowsList.useQuery(
    { subchatId: subchatId ?? '' },
    { enabled: open && !!subchatId }
  )
  const invalidate = (): void => {
    utils.playbooks.list.invalidate()
  }
  const create = trpc.playbooks.create.useMutation({ onSuccess: invalidate })
  const update = trpc.playbooks.update.useMutation({ onSuccess: invalidate })
  const remove = trpc.playbooks.delete.useMutation({ onSuccess: invalidate })

  const [view, setView] = useState<View>({ kind: 'list' })
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftText, setDraftText] = useState('')

  useEffect(() => {
    if (!open) {
      setView({ kind: 'list' })
      setDraftOpen(false)
    }
  }, [open])

  const rows = list.data ?? []
  const workflowIds = new Set((workflows.data ?? []).map((w) => w.id))
  const mutationError = create.error ?? update.error ?? remove.error
  const defaultInputError = jsonObjectError(form.defaultInputJson)
  const formValid = form.name.trim() !== '' && form.workflowId !== '' && !defaultInputError

  const submit = (): void => {
    if (!formValid || !projectId || view.kind !== 'edit') return
    const common = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      workflowId: form.workflowId,
      defaultInputJson: form.defaultInputJson.trim() || undefined
    }
    if (view.id === null) {
      create.mutate({ projectId, ...common }, { onSuccess: () => setView({ kind: 'list' }) })
    } else {
      update.mutate({ id: view.id, ...common }, { onSuccess: () => setView({ kind: 'list' }) })
    }
  }

  const runTarget = view.kind === 'run' ? rows.find((r) => r.id === view.id) : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle className="flex items-center gap-1.5">
          <BookOpenCheck size={14} />
          Playbooks
        </DialogTitle>
        <div className="flex max-h-[26rem] min-h-[14rem] flex-col gap-2 overflow-y-auto">
          {mutationError && <div className="text-[11px] text-red-500">{mutationError.message}</div>}
          {view.kind === 'edit' ? (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Name</div>
                <Input
                  value={form.name}
                  maxLength={100}
                  placeholder="Release checklist"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Description (optional)</div>
                <Input
                  value={form.description}
                  maxLength={500}
                  placeholder="What this run-book does and when to use it"
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Stored workflow</div>
                {subchatId ? (
                  <Tip content="Workflows stored by the agent SDK for this project — ask the agent in chat to create one">
                    <span className="inline-flex w-full">
                      <Select
                        value={form.workflowId || undefined}
                        onValueChange={(v) => setForm({ ...form, workflowId: v })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick a stored workflow…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(workflows.data ?? []).map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.id}
                            </SelectItem>
                          ))}
                          {form.workflowId && !workflowIds.has(form.workflowId) && (
                            <SelectItem value={form.workflowId}>
                              {form.workflowId} (missing)
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </span>
                  </Tip>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    Open a chat in this project to pick from its stored workflows.
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">
                  Default input (optional JSON object)
                </div>
                <Textarea
                  rows={3}
                  value={form.defaultInputJson}
                  className="font-mono text-[10px]"
                  spellCheck={false}
                  placeholder='e.g. {"target": "src/"}'
                  onChange={(e) => setForm({ ...form, defaultInputJson: e.target.value })}
                />
                {defaultInputError && (
                  <div className="mt-1 text-[10px] text-destructive">{defaultInputError}</div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2">
                <Tip content="Back to the playbook list without saving">
                  <Button variant="secondary" size="sm" onClick={() => setView({ kind: 'list' })}>
                    Cancel
                  </Button>
                </Tip>
                <Tip
                  content={
                    formValid
                      ? view.id === null
                        ? 'Create the playbook'
                        : 'Save changes to this playbook'
                      : 'Fill in a name, pick a workflow, and fix the default input first'
                  }
                >
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      disabled={!formValid || create.isPending || update.isPending}
                      onClick={submit}
                    >
                      {view.id === null ? 'Create playbook' : 'Save changes'}
                    </Button>
                  </span>
                </Tip>
              </div>
            </div>
          ) : view.kind === 'run' && runTarget && subchatId ? (
            <PlaybookRunView
              playbook={runTarget}
              subchatId={subchatId}
              onBack={() => setView({ kind: 'list' })}
              onRan={invalidate}
            />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">
                  Named run-books over this project&apos;s stored workflows.
                </div>
                <div className="flex items-center gap-1.5">
                  <Tip content="Describe a run-book and let this chat's agent build and save the workflow for it">
                    <span className="inline-flex">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!subchatId}
                        onClick={() => setDraftOpen((v) => !v)}
                      >
                        <Sparkles size={12} />
                        Draft with agent
                      </Button>
                    </span>
                  </Tip>
                  <Tip content="Create a playbook from an existing stored workflow">
                    <span className="inline-flex">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!projectId}
                        onClick={() => {
                          setForm(EMPTY_FORM)
                          setView({ kind: 'edit', id: null })
                        }}
                      >
                        <Plus size={12} />
                        New playbook
                      </Button>
                    </span>
                  </Tip>
                </div>
              </div>
              {draftOpen && (
                <div className="space-y-1.5 rounded border border-border p-2">
                  <div className="text-[11px] text-muted-foreground">
                    Describe what the run-book should do; the agent builds and saves a workflow for
                    it, then you link it here as a playbook.
                  </div>
                  <Textarea
                    rows={2}
                    value={draftText}
                    placeholder="e.g. run the test suite, fix simple failures, and summarize the changes"
                    onChange={(e) => setDraftText(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Tip content="Send the drafting prompt to the active chat and close this dialog">
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          disabled={!draftText.trim() || !subchatId}
                          onClick={() => {
                            onDraftWithAgent(draftText.trim())
                            setDraftText('')
                            setDraftOpen(false)
                            onOpenChange(false)
                          }}
                        >
                          Ask the agent
                        </Button>
                      </span>
                    </Tip>
                  </div>
                </div>
              )}
              {list.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
              {list.error && (
                <div className="text-[11px] text-red-500">
                  Failed to load playbooks: {list.error.message}
                </div>
              )}
              {!subchatId && (
                <div className="text-[11px] text-muted-foreground">
                  Open a chat in this project to run playbooks — workflow storage is read via the
                  chat&apos;s agent host.
                </div>
              )}
              {list.data && rows.length === 0 && (
                <div className="text-[11px] text-muted-foreground">
                  No playbooks yet. Link an existing stored workflow, or use “Draft with agent” to
                  have one built from a description.
                </div>
              )}
              {rows.map((row) => {
                const status = row.lastRunStatus ? STATUS_STYLES[row.lastRunStatus] : undefined
                const missing = !!workflows.data && !workflowIds.has(row.workflowId)
                return (
                  <div key={row.id} className="rounded border border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium" title={row.name}>
                            {row.name}
                          </span>
                          {missing && (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-500">
                              workflow missing
                            </span>
                          )}
                        </div>
                        {row.description && (
                          <div className="truncate text-[10px] text-muted-foreground">
                            {row.description}
                          </div>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span className="truncate font-mono" title={row.workflowId}>
                            {row.workflowId}
                          </span>
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
                          subchatId
                            ? 'Run this playbook in the active chat (with inputs)'
                            : 'Open a chat in this project to run playbooks'
                        }
                      >
                        <span className="inline-flex">
                          <button
                            className="flex items-center text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                            disabled={!subchatId}
                            onClick={() => setView({ kind: 'run', id: row.id })}
                          >
                            <Play size={13} />
                          </button>
                        </span>
                      </Tip>
                      <Tip content="Edit this playbook's name, workflow, or default input">
                        <button
                          className="flex items-center text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() => {
                            setForm({
                              name: row.name,
                              description: row.description ?? '',
                              workflowId: row.workflowId,
                              defaultInputJson: row.defaultInputJson ?? ''
                            })
                            setView({ kind: 'edit', id: row.id })
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                      </Tip>
                      <Tip content="Delete this playbook (the stored workflow stays; linked schedules are disabled)">
                        <button
                          className="flex items-center text-muted-foreground hover:text-red-500 cursor-pointer"
                          onClick={() => {
                            void confirmDialog({
                              title: 'Delete playbook?',
                              description: `"${row.name}" will be removed. The stored workflow stays; any schedules linked to this playbook are disabled.`,
                              confirmLabel: 'Delete'
                            }).then((ok) => {
                              if (ok) remove.mutate({ id: row.id })
                            })
                          }}
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
          Playbooks are Yardarm-managed run-books over workflows stored by the agent SDK. Runs
          execute in the active chat&apos;s agent host; schedules can fire a playbook instead of a
          prompt.
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Run form + result: schema-derived fields when the workflow's input schema
 * is flat, raw-JSON fallback otherwise. */
function PlaybookRunView({
  playbook,
  subchatId,
  onBack,
  onRan
}: {
  playbook: {
    id: string
    name: string
    workflowId: string
    defaultInputJson: string | null
  }
  subchatId: string
  onBack: () => void
  onRan: () => void
}): React.JSX.Element {
  const def = trpc.projectConfig.workflowGet.useQuery({
    subchatId,
    workflowId: playbook.workflowId
  })
  const run = trpc.playbooks.run.useMutation({ onSuccess: onRan, onError: onRan })

  const fields = useMemo(
    () => (def.data ? parseInputFields(def.data.definitionJson) : null),
    [def.data]
  )
  const defaults = useMemo(() => {
    try {
      const v = JSON.parse(playbook.defaultInputJson ?? '')
      return typeof v === 'object' && v !== null && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }, [playbook.defaultInputJson])

  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [rawJson, setRawJson] = useState('')
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded || def.data === undefined) return
    setSeeded(true)
    if (fields) {
      const next: Record<string, string | boolean> = {}
      for (const f of fields) {
        const d = defaults[f.key]
        if (f.type === 'boolean') next[f.key] = typeof d === 'boolean' ? d : false
        else next[f.key] = d === undefined ? '' : String(d)
      }
      setValues(next)
    } else {
      setRawJson(playbook.defaultInputJson ?? '')
    }
  }, [seeded, def.data, fields, defaults, playbook.defaultInputJson])

  /** Build the run input; null = invalid form. */
  const buildInput = (): { inputJson?: string } | null => {
    if (fields) {
      const out: Record<string, unknown> = {}
      for (const f of fields) {
        const v = values[f.key]
        if (f.type === 'boolean') {
          out[f.key] = v === true
        } else if (typeof v === 'string' && v.trim() !== '') {
          if (f.type === 'number') {
            const n = Number(v)
            if (!Number.isFinite(n)) return null
            out[f.key] = n
          } else {
            out[f.key] = v
          }
        } else if (f.required) {
          return null
        }
      }
      return { inputJson: JSON.stringify(out) }
    }
    const err = jsonObjectError(rawJson)
    if (err) return null
    return rawJson.trim() ? { inputJson: rawJson } : {}
  }
  const input = buildInput()
  const rawError = fields ? null : jsonObjectError(rawJson)

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">Run “{playbook.name}”</div>
      {def.isLoading && <div className="text-[11px] text-muted-foreground">Loading workflow…</div>}
      {def.error && (
        <div className="text-[11px] text-red-500">
          Failed to load the workflow definition: {def.error.message}
        </div>
      )}
      {fields && fields.length === 0 && (
        <div className="text-[11px] text-muted-foreground">This workflow takes no input.</div>
      )}
      {fields &&
        fields.map((f) => (
          <div key={f.key}>
            <div className="mb-1 text-[11px] text-muted-foreground">
              <span className="font-mono">{f.key}</span>
              {f.required && <span className="text-destructive"> *</span>}
              {f.description && <span> — {f.description}</span>}
            </div>
            {f.type === 'boolean' ? (
              <Tip content={`Toggle the "${f.key}" input`}>
                <span className="inline-flex">
                  <Switch
                    checked={values[f.key] === true}
                    onCheckedChange={(v) => setValues({ ...values, [f.key]: v })}
                  />
                </span>
              </Tip>
            ) : (
              <Input
                type={f.type === 'number' ? 'number' : 'text'}
                value={typeof values[f.key] === 'string' ? (values[f.key] as string) : ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </div>
        ))}
      {!fields && def.data !== undefined && (
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">
            Input (JSON object) — this workflow&apos;s input schema is not a simple form
          </div>
          <Textarea
            rows={4}
            value={rawJson}
            className="font-mono text-[10px]"
            spellCheck={false}
            placeholder='e.g. {"target": "src/"}'
            onChange={(e) => setRawJson(e.target.value)}
          />
          {rawError && <div className="mt-1 text-[10px] text-destructive">{rawError}</div>}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Tip content="Back to the playbook list">
          <Button variant="secondary" size="sm" onClick={onBack}>
            Back
          </Button>
        </Tip>
        <Tip
          content={
            input
              ? 'Run the workflow to completion and show each step — a marker is posted in the chat'
              : 'Fill in the required inputs (or fix the JSON) first'
          }
        >
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!input || run.isPending || def.data === undefined}
              onClick={() => {
                if (input) run.mutate({ playbookId: playbook.id, subchatId, ...input })
              }}
            >
              {run.isPending ? 'Running…' : 'Run playbook'}
            </Button>
          </span>
        </Tip>
      </div>
      {run.error && (
        <div className="text-[10px] text-destructive selectable">{run.error.message}</div>
      )}
      {run.data && (
        <div className="space-y-0.5 rounded bg-accent/40 p-1.5 text-[10px]">
          <div>
            Status: <span className="font-medium">{run.data.status}</span>
          </div>
          {run.data.steps.map((s, i) => (
            <div key={`${s.id}-${i}`} className="font-mono">
              {s.id}: {s.status}
            </div>
          ))}
          {run.data.error && <div className="text-destructive selectable">{run.data.error}</div>}
          {run.data.resultJson && (
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono selectable">
              {run.data.resultJson}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
