/**
 * First-run setup wizard mirroring the mastracode CLI's onboarding flow
 * (Welcome → Auth → Mode pack → OM pack → YOLO → Summary). Nothing is
 * persisted until Finish or Skip, which write the CLI-compatible
 * `onboarding.*` keys in the shared settings.json.
 */
import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, KeyRound } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { KeysTab } from '../settings/SettingsDialog'
import { Logo } from '../../components/Logo'

const STEPS = ['welcome', 'auth', 'modePack', 'omPack', 'yolo', 'summary'] as const
type Step = (typeof STEPS)[number]

const MODES = ['build', 'plan', 'fast'] as const

interface Draft {
  modePackId: string | null
  customModeModels: Record<string, string>
  omPackId: string | null
  omCustomModel: string | null
  yolo: boolean
}

function ModelSelect({
  value,
  onChange,
  models,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  models: Array<{ id: string; hasApiKey: boolean }>
  placeholder: string
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[11px]"
    >
      <option value="">{placeholder}</option>
      {models.map((m) => (
        <option key={m.id} value={m.id} disabled={!m.hasApiKey}>
          {m.id}
          {!m.hasApiKey ? ' (no key)' : ''}
        </option>
      ))}
    </select>
  )
}

function OptionCard({
  selected,
  onClick,
  title,
  subtitle,
  children
}: {
  selected: boolean
  onClick: () => void
  title: string
  subtitle?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-md border px-3 py-2.5 transition-colors',
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
      </div>
      {subtitle && <div className="mt-1 pl-5.5 text-[11px] text-muted-foreground">{subtitle}</div>}
      {children && <div className="mt-2 pl-5.5">{children}</div>}
    </div>
  )
}

export function OnboardingWizard({ onDone }: { onDone: () => void }): React.JSX.Element {
  const utils = trpc.useUtils()
  const [step, setStep] = useState<Step>('welcome')
  const [draft, setDraft] = useState<Draft>({
    modePackId: null,
    customModeModels: {},
    omPackId: null,
    omCustomModel: null,
    yolo: false
  })

  const settings = trpc.mastraSettings.get.useQuery(undefined, { refetchOnWindowFocus: false })
  const packs = trpc.mastraSettings.listPacks.useQuery()
  const models = trpc.agent.listModels.useQuery(undefined)
  const auth = trpc.settings.authList.useQuery()
  const oauth = trpc.settings.oauthProviders.useQuery()

  const skip = trpc.mastraSettings.skipOnboarding.useMutation()
  const complete = trpc.mastraSettings.completeOnboarding.useMutation()

  // Prefill from a previous run (re-run via Settings → About).
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !settings.data) return
    prefilled.current = true
    const s = settings.data
    const ob = s.onboarding
    setDraft((d) => ({
      modePackId: ob?.modePackId ?? d.modePackId,
      customModeModels:
        ob?.modePackId === 'custom' ? { ...(s.models?.modeDefaults ?? {}) } : d.customModeModels,
      omPackId: ob?.omPackId ?? d.omPackId,
      omCustomModel:
        ob?.omPackId === 'custom' ? (s.models?.omModelOverride ?? null) : d.omCustomModel,
      yolo: s.preferences?.yolo ?? d.yolo
    }))
  }, [settings.data])

  // Auth may have changed on the previous step — refresh what depends on it.
  useEffect(() => {
    if (step === 'modePack') {
      void packs.refetch()
      void models.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const modelList = models.data ?? []
  const modePacks = packs.data?.modePacks ?? []
  const omPacks = packs.data?.omPacks ?? []
  const connected = new Set<string>([
    ...(auth.data ?? []).filter((a) => a.hasKey).map((a) => a.provider),
    ...(oauth.data ?? []).filter((p) => p.loggedIn).map((p) => p.id)
  ])

  const customModeComplete = MODES.every((m) => !!draft.customModeModels[m])
  const canContinue =
    step !== 'modePack' || draft.modePackId !== 'custom' || customModeComplete

  const stepIndex = STEPS.indexOf(step)
  const back = (): void => setStep(STEPS[Math.max(0, stepIndex - 1)])
  const next = (): void => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)])

  async function doSkip(): Promise<void> {
    try {
      await skip.mutateAsync()
    } catch {
      return // surfaced via skip.error below
    }
    await utils.mastraSettings.get.invalidate()
    onDone()
  }

  async function doFinish(): Promise<void> {
    const selectedPack = modePacks.find((p) => p.id === draft.modePackId)
    try {
      await complete.mutateAsync({
        modePackId: draft.modePackId,
        modeModels:
          draft.modePackId === 'custom'
            ? draft.customModeModels
            : draft.modePackId?.startsWith('custom:')
              ? selectedPack?.models
              : undefined,
        omPackId: draft.omPackId,
        omModel: draft.omPackId === 'custom' ? draft.omCustomModel : undefined,
        yolo: draft.yolo
      })
    } catch {
      return // surfaced via complete.error on the summary step
    }
    await Promise.all([
      utils.mastraSettings.get.invalidate(),
      utils.agent.listModels.invalidate()
    ])
    onDone()
  }

  const packName = (id: string | null): string => {
    if (!id) return 'Keep current settings'
    if (id === 'custom') return 'Custom (per-mode picks)'
    return modePacks.find((p) => p.id === id)?.name ?? id
  }
  const omPackName = (id: string | null): string => {
    if (!id) return 'None (default)'
    if (id === 'custom') return `Custom${draft.omCustomModel ? ` (${draft.omCustomModel})` : ''}`
    return omPacks.find((p) => p.id === id)?.name ?? id
  }

  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag h-10 shrink-0" />
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto">
        <div className="flex w-full max-w-lg flex-col gap-5 px-8 pb-10">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-10 rounded-lg" />
            <div>
              <div className="text-base font-semibold">
                {step === 'welcome' && 'Welcome to Yardarm'}
                {step === 'auth' && 'Connect a model provider'}
                {step === 'modePack' && 'Choose your models'}
                {step === 'omPack' && 'Observational Memory'}
                {step === 'yolo' && 'Tool approvals'}
                {step === 'summary' && 'Review your setup'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Step {stepIndex + 1} of {STEPS.length}
              </div>
            </div>
          </div>

          {/* Step body */}
          <div className="min-h-64">
            {step === 'welcome' && (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Yardarm runs Mastra Code agents against your local git repositories. This quick
                  setup connects a model provider and picks the models the agents will use — the
                  same onboarding the mastracode CLI runs, sharing the same configuration.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  You can re-run this any time from Settings → About, and change everything later
                  in Settings.
                </p>
              </div>
            )}

            {step === 'auth' && (
              <div className="space-y-3">
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
                    connected.size > 0
                      ? 'border-green-600/40 text-green-500'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  <KeyRound size={13} />
                  {connected.size > 0
                    ? `${connected.size} provider${connected.size === 1 ? '' : 's'} connected`
                    : 'No providers connected yet — add an API key or log in below.'}
                </div>
                <KeysTab />
              </div>
            )}

            {step === 'modePack' && (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground">
                  A model pack assigns a model to each agent mode (build, plan, fast). Packs are
                  shown for providers you&apos;ve connected.
                </div>
                {packs.isLoading && (
                  <div className="text-xs text-muted-foreground">Loading packs…</div>
                )}
                {!packs.isLoading && modePacks.length === 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <div className="space-y-1.5">
                      <div>
                        No packs are available because no provider is connected yet. Go back to
                        sign in, pick custom models below, or continue and set this up later.
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setStep('auth')}>
                        Back to sign-in
                      </Button>
                    </div>
                  </div>
                )}
                {modePacks.map((p) => (
                  <OptionCard
                    key={p.id}
                    selected={draft.modePackId === p.id}
                    onClick={() => setDraft((d) => ({ ...d, modePackId: p.id }))}
                    title={p.name}
                    subtitle={
                      <span className="font-mono">
                        {MODES.map((m) => p.models[m])
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    }
                  />
                ))}
                <OptionCard
                  selected={draft.modePackId === 'custom'}
                  onClick={() => setDraft((d) => ({ ...d, modePackId: 'custom' }))}
                  title="Custom"
                  subtitle="Pick a model for each mode yourself."
                >
                  {draft.modePackId === 'custom' && (
                    <div className="space-y-1.5">
                      {MODES.map((mode) => (
                        <div key={mode} className="flex items-center gap-2">
                          <span className="w-10 text-[11px] capitalize text-muted-foreground">
                            {mode}
                          </span>
                          <ModelSelect
                            value={draft.customModeModels[mode] ?? ''}
                            onChange={(v) =>
                              setDraft((d) => ({
                                ...d,
                                customModeModels: { ...d.customModeModels, [mode]: v }
                              }))
                            }
                            models={modelList}
                            placeholder="Select model…"
                          />
                        </div>
                      ))}
                      {!customModeComplete && (
                        <div className="text-[11px] text-muted-foreground">
                          Pick a model for all three modes to continue.
                        </div>
                      )}
                    </div>
                  )}
                </OptionCard>
                <OptionCard
                  selected={draft.modePackId === null}
                  onClick={() => setDraft((d) => ({ ...d, modePackId: null }))}
                  title="Decide later"
                  subtitle="Keep current model settings; configure in Settings → Models."
                />
              </div>
            )}

            {step === 'omPack' && (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground">
                  Observational Memory summarizes long sessions in the background so agents keep
                  context without huge prompts. Pick the model that does the summarizing.
                </div>
                <OptionCard
                  selected={draft.omPackId === null}
                  onClick={() => setDraft((d) => ({ ...d, omPackId: null }))}
                  title="None (default)"
                  subtitle="Use mastracode's default behavior."
                />
                {omPacks
                  .filter((p) => p.id !== 'custom')
                  .map((p) => (
                    <OptionCard
                      key={p.id}
                      selected={draft.omPackId === p.id}
                      onClick={() => setDraft((d) => ({ ...d, omPackId: p.id }))}
                      title={p.name}
                      subtitle={<span className="font-mono">{p.modelId}</span>}
                    />
                  ))}
                <OptionCard
                  selected={draft.omPackId === 'custom'}
                  onClick={() => setDraft((d) => ({ ...d, omPackId: 'custom' }))}
                  title="Custom"
                  subtitle="Pick the OM model yourself."
                >
                  {draft.omPackId === 'custom' && (
                    <ModelSelect
                      value={draft.omCustomModel ?? ''}
                      onChange={(v) => setDraft((d) => ({ ...d, omCustomModel: v || null }))}
                      models={modelList}
                      placeholder="Select model…"
                    />
                  )}
                </OptionCard>
              </div>
            )}

            {step === 'yolo' && (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={draft.yolo}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, yolo: v }))}
                  />
                  Auto-approve tool use (YOLO mode)
                </label>
                <div className="text-[11px] text-muted-foreground">
                  When enabled, agents run shell commands and edit files without asking first. Use
                  with caution — you can toggle this per-chat or in Settings → Preferences later.
                </div>
              </div>
            )}

            {step === 'summary' && (
              <div className="space-y-2">
                {(
                  [
                    {
                      label: 'Providers',
                      value:
                        connected.size > 0
                          ? [...connected].join(', ')
                          : 'None connected',
                      target: 'auth' as Step
                    },
                    { label: 'Model pack', value: packName(draft.modePackId), target: 'modePack' as Step },
                    { label: 'Observational Memory', value: omPackName(draft.omPackId), target: 'omPack' as Step },
                    { label: 'YOLO mode', value: draft.yolo ? 'On' : 'Off', target: 'yolo' as Step }
                  ] as Array<{ label: string; value: string; target: Step }>
                ).map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <span className="w-40 shrink-0 text-xs text-muted-foreground">{row.label}</span>
                    <span className="min-w-0 flex-1 truncate text-xs">{row.value}</span>
                    <button
                      className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => setStep(row.target)}
                    >
                      Edit
                    </button>
                  </div>
                ))}
                {complete.error && (
                  <div className="text-xs text-destructive selectable">
                    {complete.error.message}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3">
            {step !== 'welcome' ? (
              <Button variant="ghost" size="sm" onClick={back} disabled={complete.isPending}>
                <ArrowLeft size={13} />
                Back
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void doSkip()}
                disabled={skip.isPending}
              >
                {skip.isPending ? 'Skipping…' : 'Skip setup'}
              </Button>
            )}
            <div className="flex flex-1 items-center justify-center gap-1.5">
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    i === stepIndex ? 'bg-primary' : 'bg-border'
                  )}
                />
              ))}
            </div>
            {step !== 'summary' ? (
              <Button size="sm" onClick={next} disabled={!canContinue}>
                Continue
                <ArrowRight size={13} />
              </Button>
            ) : (
              <Button size="sm" onClick={() => void doFinish()} disabled={complete.isPending}>
                {complete.isPending ? 'Applying and restarting agents…' : 'Finish'}
              </Button>
            )}
          </div>
          {skip.error && (
            <div className="text-xs text-destructive selectable">{skip.error.message}</div>
          )}
        </div>
      </div>
    </div>
  )
}
