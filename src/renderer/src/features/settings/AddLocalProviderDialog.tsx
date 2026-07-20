/**
 * Guided "Add local model" wizard: pick a local server (auto-detected),
 * install/start Ollama if needed, download recommended models with live
 * progress, select models, and save — all into mastracode's settings.json
 * `customProviders` via the existing upsert path.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Download, ExternalLink, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Tip } from '../../components/ui/tooltip'
import type { ProbeResult, PullJob } from '../../../../shared/mastra-settings'
import {
  LOCAL_PROVIDER_PRESETS,
  RECOMMENDED_MODELS,
  type LocalProviderPreset
} from './local-provider-presets'

type Step = 'choose' | 'connect' | 'save'

interface ProbeState {
  status: 'idle' | 'testing' | 'ok' | 'failed'
  models: string[]
  error?: string
  /** Normalized URL that actually responded (saved to settings). */
  url: string
}

const IDLE_PROBE: ProbeState = { status: 'idle', models: [], url: '' }

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  return `${Math.round(n / 1024)} KB`
}

function OptionCard({
  selected,
  onClick,
  title,
  subtitle,
  badge
}: {
  selected: boolean
  onClick: () => void
  title: string
  subtitle?: string
  badge?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-md border px-3 py-2 transition-colors',
        selected ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
          )}
        >
          {selected && <Check size={9} strokeWidth={3} />}
        </div>
        <div className="text-xs font-medium">{title}</div>
        {badge}
      </div>
      {subtitle && (
        <div className="mt-0.5 pl-5.5 text-[11px] text-muted-foreground">{subtitle}</div>
      )}
    </div>
  )
}

function ModelRow({
  label,
  note,
  checked,
  onToggle
}: {
  label: string
  note?: string
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors cursor-pointer',
        checked ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
      )}
    >
      <div
        className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        )}
      >
        {checked && <Check size={9} strokeWidth={3} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11px]">{label}</div>
        {note && <div className="truncate text-[10px] text-muted-foreground">{note}</div>}
      </div>
    </button>
  )
}

export function AddLocalProviderDialog({
  open,
  onOpenChange,
  existingNames
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingNames: string[]
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const [step, setStep] = useState<Step>('choose')
  const [presetId, setPresetId] = useState<LocalProviderPreset['id']>('ollama')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [name, setName] = useState('')
  const [scan, setScan] = useState<Record<string, ProbeResult>>({})
  const [probe, setProbe] = useState<ProbeState>(IDLE_PROBE)
  const [ollama, setOllama] = useState<'unknown' | 'running' | 'installed' | 'not-installed'>(
    'unknown'
  )
  const [starting, setStarting] = useState(false)
  const [pulls, setPulls] = useState<Record<string, PullJob>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [manualModels, setManualModels] = useState('')

  const preset = LOCAL_PROVIDER_PRESETS.find((p) => p.id === presetId)!
  const startModelPull = trpc.mastraSettings.startModelPull.useMutation()
  const cancelModelPull = trpc.mastraSettings.cancelModelPull.useMutation()
  const startOllamaMut = trpc.mastraSettings.startOllama.useMutation()
  const upsert = trpc.mastraSettings.upsertCustomProvider.useMutation()
  const applyRestart = trpc.mastraSettings.applyRestart.useMutation()

  // Save, then restart agent hosts (they read settings.json at boot) and
  // refresh the cached model catalog so the new models are usable immediately.
  const doSave = async (provider: {
    name: string
    url: string
    apiKey?: string
    models: string[]
  }): Promise<void> => {
    try {
      await upsert.mutateAsync(provider)
      await applyRestart.mutateAsync()
    } catch {
      return
    }
    await Promise.all([utils.mastraSettings.get.invalidate(), utils.agent.listModels.invalidate()])
    onOpenChange(false)
  }

  const probeUrl = useCallback(
    (u: string, key: string): Promise<ProbeResult> =>
      utils.client.mastraSettings.probeProvider.query({
        url: u,
        apiKey: key.trim() || undefined
      }),
    [utils]
  )

  const runTest = useCallback(
    async (u: string, key: string): Promise<boolean> => {
      setProbe({ status: 'testing', models: [], url: '' })
      try {
        const res = await probeUrl(u, key)
        if (res.ok) {
          setProbe({ status: 'ok', models: res.models, url: res.url })
          return true
        }
        setProbe({ status: 'failed', models: [], error: res.error, url: res.url })
      } catch (err) {
        setProbe({
          status: 'failed',
          models: [],
          error: err instanceof Error ? err.message : String(err),
          url: u
        })
      }
      return false
    },
    [probeUrl]
  )

  // Reset everything when the dialog closes; cancel any in-flight downloads.
  const pullsRef = useRef(pulls)
  pullsRef.current = pulls
  useEffect(() => {
    if (open) return
    for (const job of Object.values(pullsRef.current)) {
      if (job.status === 'running') cancelModelPull.mutate({ jobId: job.jobId })
    }
    setStep('choose')
    setPresetId('ollama')
    setUrl('')
    setApiKey('')
    setName('')
    setScan({})
    setProbe(IDLE_PROBE)
    setOllama('unknown')
    setStarting(false)
    setPulls({})
    setSelected(new Set())
    setManualModels('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Auto-scan the default ports on open so running servers get a badge.
  useEffect(() => {
    if (!open) return
    let alive = true
    for (const p of LOCAL_PROVIDER_PRESETS) {
      if (!p.defaultUrl) continue
      probeUrl(p.defaultUrl, '')
        .then((res) => {
          if (alive && res.ok) setScan((s) => ({ ...s, [p.id]: res }))
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [open, probeUrl])

  // Poll running model downloads; on completion refresh the model list and
  // auto-select the freshly installed model.
  useEffect(() => {
    const running = Object.values(pulls).filter((p) => p.status === 'running')
    if (running.length === 0) return
    const id = setInterval(() => {
      for (const job of running) {
        utils.client.mastraSettings.pullStatus
          .query({ jobId: job.jobId })
          .then((s) => {
            if (!s) return
            setPulls((prev) => ({ ...prev, [s.model]: s }))
            if (s.status === 'done') {
              setSelected((prev) => new Set(prev).add(s.model))
              void runTest(url, apiKey)
            }
          })
          .catch(() => {})
      }
    }, 600)
    return () => clearInterval(id)
  }, [pulls, utils, runTest, url, apiKey])

  // Guided Ollama setup: while the connect step shows a failed Ollama probe,
  // keep checking install status so the wizard advances the moment the user
  // finishes installing/starting Ollama.
  const showOllamaSetup = step === 'connect' && presetId === 'ollama' && probe.status === 'failed'
  useEffect(() => {
    if (!showOllamaSetup) return
    let alive = true
    const check = (): void => {
      utils.client.mastraSettings.ollamaStatus
        .query()
        .then(async (s) => {
          if (!alive) return
          setOllama(s)
          if (s === 'running') await runTest(url, apiKey)
        })
        .catch(() => {})
    }
    check()
    const id = setInterval(check, 3000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [showOllamaSetup, utils, runTest, url, apiKey])

  const goConnect = async (): Promise<void> => {
    setStep('connect')
    const cached = scan[preset.id]
    if (cached?.ok && url === preset.defaultUrl) {
      setProbe({ status: 'ok', models: cached.models, url: cached.url })
      return
    }
    await runTest(url, apiKey)
  }

  const doStartOllama = async (): Promise<void> => {
    setStarting(true)
    try {
      await startOllamaMut.mutateAsync()
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const res = await probeUrl(url, apiKey)
        if (res.ok) {
          setProbe({ status: 'ok', models: res.models, url: res.url })
          return
        }
      }
      setProbe((p) => ({ ...p, error: 'Ollama did not start in time — try again.' }))
    } finally {
      setStarting(false)
    }
  }

  const doPull = (tag: string): void => {
    startModelPull.mutate(
      { url: probe.url || url, model: tag },
      {
        onSuccess: ({ jobId }) => {
          setPulls((prev) => ({
            ...prev,
            [tag]: {
              jobId,
              model: tag,
              status: 'running',
              statusText: 'starting',
              completed: 0,
              total: 0
            }
          }))
        }
      }
    )
  }

  const manualList = manualModels
    .split(/[\n,]/)
    .map((m) => m.trim())
    .filter(Boolean)
  const chosenModels = [...new Set([...selected, ...manualList])]
  const installedSet = new Set(probe.models)
  const recommendedTags = new Set(RECOMMENDED_MODELS.map((r) => r.tag))
  const otherInstalled = probe.models.filter((m) => !recommendedTags.has(m))
  const nameTaken = existingNames.includes(name.trim())
  const anyPullRunning = Object.values(pulls).some((p) => p.status === 'running')

  const toggle = (model: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(model)) next.delete(model)
      else next.add(model)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogTitle>Add local model</DialogTitle>

        {step === 'choose' && (
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground">
              Run models on your own machine — private and free. Which server do you use (or want to
              use)?
            </div>
            <div className="space-y-1.5">
              {[...LOCAL_PROVIDER_PRESETS]
                .sort((a, b) => (scan[b.id] ? 1 : 0) - (scan[a.id] ? 1 : 0))
                .map((p) => (
                  <OptionCard
                    key={p.id}
                    selected={presetId === p.id}
                    onClick={() => {
                      setPresetId(p.id)
                      setUrl(p.defaultUrl)
                      setName(p.defaultName)
                      setProbe(IDLE_PROBE)
                    }}
                    title={p.title}
                    subtitle={p.subtitle}
                    badge={
                      scan[p.id] ? (
                        <span className="rounded-full bg-green-500/15 px-1.5 py-px text-[10px] font-medium text-green-500">
                          Running
                        </span>
                      ) : undefined
                    }
                  />
                ))}
            </div>
            {presetId === 'custom' && (
              <Input
                placeholder="Base URL (e.g. http://localhost:11434/v1)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!url.trim() && presetId === 'custom'}
                onClick={() => {
                  if (!url) {
                    setUrl(preset.defaultUrl)
                    setName(preset.defaultName)
                  }
                  void goConnect()
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 'connect' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                placeholder="Base URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Tip content="Check that the server responds and list its installed models">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={probe.status === 'testing' || !url.trim()}
                    onClick={() => void runTest(url, apiKey)}
                  >
                    {probe.status === 'testing' ? 'Testing…' : 'Test connection'}
                  </Button>
                </span>
              </Tip>
            </div>
            {preset.apiKey === 'optional' && (
              <Input
                type="password"
                placeholder="API key (optional)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            )}

            {showOllamaSetup && ollama === 'not-installed' && (
              <div className="space-y-2 rounded border border-border p-2.5">
                <div className="text-xs font-medium">Get Ollama</div>
                <div className="text-[11px] text-muted-foreground">
                  Ollama runs models on your machine — free, no account. Install it, then this
                  wizard will continue automatically.
                </div>
                <Button
                  size="sm"
                  onClick={() => window.open(preset.downloadUrl ?? 'https://ollama.com/download')}
                >
                  <ExternalLink size={12} className="mr-1" />
                  Download Ollama
                </Button>
                <div className="text-[11px] text-muted-foreground">Waiting for Ollama…</div>
              </div>
            )}
            {showOllamaSetup && ollama === 'installed' && (
              <div className="space-y-2 rounded border border-border p-2.5">
                <div className="text-xs font-medium">Ollama is installed but not running</div>
                <Button size="sm" disabled={starting} onClick={() => void doStartOllama()}>
                  {starting ? 'Starting…' : 'Start Ollama'}
                </Button>
              </div>
            )}
            {probe.status === 'failed' &&
              !(showOllamaSetup && (ollama === 'not-installed' || ollama === 'installed')) && (
                <div className="space-y-1">
                  <div className="text-xs text-destructive selectable">{probe.error}</div>
                  <div className="text-[11px] text-muted-foreground">{preset.downHint}</div>
                  {preset.downloadUrl && presetId !== 'ollama' && (
                    <button
                      className="flex items-center gap-1 text-[11px] text-muted-foreground underline hover:text-foreground cursor-pointer"
                      onClick={() => window.open(preset.downloadUrl)}
                    >
                      <ExternalLink size={10} />
                      Get {preset.title}
                    </button>
                  )}
                </div>
              )}

            {probe.status === 'ok' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">Recommended models</div>
                  {RECOMMENDED_MODELS.map((r) => {
                    const installed = installedSet.has(r.tag)
                    const job = pulls[r.tag]
                    if (installed) {
                      return (
                        <div key={r.tag} className="flex items-center gap-2">
                          <div className="flex-1">
                            <ModelRow
                              label={r.label}
                              note={`${r.note} · ${r.sizeLabel}`}
                              checked={selected.has(r.tag)}
                              onToggle={() => toggle(r.tag)}
                            />
                          </div>
                          <span className="shrink-0 rounded-full bg-green-500/15 px-1.5 py-px text-[10px] text-green-500">
                            Installed
                          </span>
                        </div>
                      )
                    }
                    if (job?.status === 'running') {
                      return (
                        <div key={r.tag} className="rounded border border-border px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1 truncate font-mono text-[11px]">
                              {r.tag}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {job.total > 0
                                ? `${fmtBytes(job.completed)} / ${fmtBytes(job.total)}`
                                : job.statusText}
                            </div>
                            <Tip content="Cancel this model download">
                              <button
                                className="text-muted-foreground hover:text-destructive cursor-pointer"
                                onClick={() => {
                                  cancelModelPull.mutate({ jobId: job.jobId })
                                  setPulls((prev) => ({
                                    ...prev,
                                    [r.tag]: { ...job, status: 'cancelled' }
                                  }))
                                }}
                              >
                                <X size={12} />
                              </button>
                            </Tip>
                          </div>
                          <div className="mt-1 h-1 overflow-hidden rounded bg-accent">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{
                                width:
                                  job.total > 0
                                    ? `${Math.min(100, (job.completed / job.total) * 100)}%`
                                    : '4%'
                              }}
                            />
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div
                        key={r.tag}
                        className="flex items-center gap-2 rounded border border-border px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium">{r.label}</div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {r.note} · {r.sizeLabel}
                            {job?.status === 'error' && (
                              <span className="text-destructive"> · {job.error}</span>
                            )}
                            {job?.status === 'cancelled' && ' · cancelled'}
                          </div>
                        </div>
                        {presetId === 'ollama' ? (
                          <Tip
                            content={`Download ${r.tag} to your machine via Ollama (${r.sizeLabel})`}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => doPull(r.tag)}
                            >
                              <Download size={11} className="mr-1" />
                              {job?.status === 'error' || job?.status === 'cancelled'
                                ? 'Retry'
                                : 'Download'}
                            </Button>
                          </Tip>
                        ) : (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {presetId === 'lmstudio' ? 'Get it in LM Studio' : 'Not installed'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {anyPullRunning && (
                    <div className="text-[10px] text-muted-foreground">
                      Keep this dialog open while downloading — the model is selected automatically
                      when it finishes.
                    </div>
                  )}
                </div>

                {otherInstalled.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium">Installed models</div>
                      <button
                        className="text-[10px] text-muted-foreground underline hover:text-foreground cursor-pointer"
                        onClick={() =>
                          setSelected((prev) =>
                            prev.size >= probe.models.length
                              ? new Set()
                              : new Set([...prev, ...probe.models])
                          )
                        }
                      >
                        Select all
                      </button>
                    </div>
                    {otherInstalled.map((m) => (
                      <ModelRow
                        key={m}
                        label={m}
                        checked={selected.has(m)}
                        onToggle={() => toggle(m)}
                      />
                    ))}
                  </div>
                )}

                {probe.models.length === 0 && (
                  <div className="space-y-1.5">
                    {preset.emptyHint && (
                      <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
                        {preset.emptyHint}
                      </div>
                    )}
                    <Input
                      placeholder="Or enter model ids manually, comma-separated"
                      value={manualModels}
                      onChange={(e) => setManualModels(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between">
              <Button size="sm" variant="ghost" onClick={() => setStep('choose')}>
                Back
              </Button>
              <Button
                size="sm"
                disabled={probe.status !== 'ok' || chosenModels.length === 0}
                onClick={() => setStep('save')}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 'save' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">Provider name</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {nameTaken && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
                A provider named &quot;{name.trim()}&quot; already exists — saving will overwrite
                it.
              </div>
            )}
            <div className="rounded border border-border px-2 py-1.5 text-[11px] text-muted-foreground">
              <div className="truncate font-mono">{probe.url || url}</div>
              <div>
                {chosenModels.length} model{chosenModels.length === 1 ? '' : 's'}:{' '}
                {chosenModels.join(', ')}
              </div>
            </div>
            {(upsert.error ?? applyRestart.error) && (
              <div className="text-xs text-destructive selectable">
                {(upsert.error ?? applyRestart.error)?.message}
              </div>
            )}
            <div className="flex justify-between">
              <Button size="sm" variant="ghost" onClick={() => setStep('connect')}>
                Back
              </Button>
              <Button
                size="sm"
                disabled={
                  !name.trim() ||
                  chosenModels.length === 0 ||
                  upsert.isPending ||
                  applyRestart.isPending
                }
                onClick={() =>
                  void doSave({
                    name: name.trim(),
                    url: probe.url || url.trim(),
                    apiKey: apiKey.trim() || undefined,
                    models: chosenModels
                  })
                }
              >
                {upsert.isPending ? 'Saving…' : applyRestart.isPending ? 'Applying…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
