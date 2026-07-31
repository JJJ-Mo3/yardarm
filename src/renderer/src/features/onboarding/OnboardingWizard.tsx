/**
 * First-run setup wizard extending the mastracode CLI's onboarding flow
 * (Welcome → Auth → Mode pack → OM pack → Connectors → Sub-agents → Sandbox →
 * Compression → YOLO → Summary). The auth and connectors steps apply
 * immediately (auth.json / mcp.json); everything else is drafted and persisted
 * on Finish — model/OM/YOLO choices via the CLI-compatible `onboarding.*` keys
 * in the shared settings.json, sandbox/compression via the app-DB settings,
 * and selected sub-agent templates via a global install.
 */
import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, KeyRound } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { KeysTab } from '../settings/SettingsDialog'
import { OAuthSection } from '../settings/OAuthSection'
import { ConnectorsTab } from '../settings/ConnectorsTab'
import { CONNECTORS, connectorState } from '../settings/connector-catalog'
import { Logo } from '../../components/Logo'
import { ModelSelect } from '../../components/ModelSelect'

const STEPS = [
  'welcome',
  'auth',
  'modePack',
  'omPack',
  'connectors',
  'subagents',
  'sandbox',
  'compression',
  'yolo',
  'summary'
] as const
type Step = (typeof STEPS)[number]

const MODES = ['build', 'plan', 'fast'] as const

// Same grouping labels as Settings → Agents.
const TEMPLATE_GROUPS = [
  ['role', 'Role subagents'],
  ['specialist', 'Domain specialists']
] as const

interface Draft {
  modePackId: string | null
  customModeModels: Record<string, string>
  omPackId: string | null
  omCustomModel: string | null
  yolo: boolean
  subagentIds: string[]
  sandboxEnabled: boolean
  sandboxNetwork: boolean
  compressionEnabled: boolean
  verbosityEnabled: boolean
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

/** Multi-select variant of OptionCard (checkbox square, supports disabled). */
function TemplateCard({
  selected,
  disabled,
  onClick,
  title,
  subtitle
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  subtitle?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={cn(
        'rounded-md border px-3 py-2 transition-colors',
        disabled
          ? 'cursor-default border-border opacity-70'
          : selected
            ? 'cursor-pointer border-primary bg-accent'
            : 'cursor-pointer border-border hover:bg-accent/50'
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border',
            selected || disabled
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border'
          )}
        >
          {(selected || disabled) && <Check size={9} strokeWidth={3} />}
        </div>
        <div className="min-w-0 flex-1 truncate text-xs font-medium">{title}</div>
        {disabled && (
          <span className="shrink-0 text-[10px] text-muted-foreground">Already installed</span>
        )}
      </div>
      {subtitle && (
        <div className="mt-1 line-clamp-2 pl-5.5 text-[11px] leading-snug text-muted-foreground">
          {subtitle}
        </div>
      )}
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
    yolo: false,
    subagentIds: [],
    sandboxEnabled: false,
    sandboxNetwork: true,
    compressionEnabled: false,
    verbosityEnabled: false
  })
  const [extrasError, setExtrasError] = useState<string | null>(null)

  const settings = trpc.mastraSettings.get.useQuery(undefined, { refetchOnWindowFocus: false })
  const packs = trpc.mastraSettings.listPacks.useQuery()
  const models = trpc.agent.listModels.useQuery(undefined)
  const auth = trpc.settings.authList.useQuery()
  const oauth = trpc.settings.oauthProviders.useQuery()
  const sandboxDefaults = trpc.settings.get.useQuery({ key: 'sandboxDefaults' })
  const tokenCompression = trpc.settings.get.useQuery({ key: 'tokenCompression' })
  const agentCatalog = trpc.projectConfig.agentDefaultsCatalog.useQuery(undefined, {
    staleTime: Infinity
  })
  const installedAgents = trpc.projectConfig.agentsList.useQuery({ scope: 'global' })
  const mcpServers = trpc.mcp.get.useQuery({})

  const skip = trpc.mastraSettings.skipOnboarding.useMutation()
  const complete = trpc.mastraSettings.completeOnboarding.useMutation()
  const setSetting = trpc.settings.set.useMutation()
  const setTokenCompression = trpc.agent.setTokenCompression.useMutation()
  const installDefaults = trpc.projectConfig.agentsInstallDefaults.useMutation()

  // Prefill from a previous run (re-run via Settings → About).
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !settings.data) return
    prefilled.current = true
    const s = settings.data
    const ob = s.onboarding
    setDraft((d) => ({
      ...d,
      modePackId: ob?.modePackId ?? d.modePackId,
      customModeModels:
        ob?.modePackId === 'custom' ? { ...(s.models?.modeDefaults ?? {}) } : d.customModeModels,
      omPackId: ob?.omPackId ?? d.omPackId,
      omCustomModel:
        ob?.omPackId === 'custom' ? (s.models?.omModelOverride ?? null) : d.omCustomModel,
      yolo: s.preferences?.yolo ?? d.yolo
    }))
  }, [settings.data])

  // Prefill sandbox/compression from current stored values (re-run case).
  // settings.get returns null when unset — undefined means still loading.
  const prefilledSandbox = useRef(false)
  useEffect(() => {
    if (prefilledSandbox.current || sandboxDefaults.data === undefined) return
    prefilledSandbox.current = true
    const sd = (sandboxDefaults.data as { enabled?: boolean; allowNetwork?: boolean } | null) ?? {}
    setDraft((d) => ({
      ...d,
      sandboxEnabled: sd.enabled === true,
      sandboxNetwork: sd.allowNetwork !== false
    }))
  }, [sandboxDefaults.data])
  const prefilledCompression = useRef(false)
  useEffect(() => {
    if (prefilledCompression.current || tokenCompression.data === undefined) return
    prefilledCompression.current = true
    const tc = (tokenCompression.data as { enabled?: boolean; verbosity?: boolean } | null) ?? {}
    setDraft((d) => ({
      ...d,
      compressionEnabled: tc.enabled === true,
      verbosityEnabled: tc.verbosity === true
    }))
  }, [tokenCompression.data])

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

  const installedIds = new Set((installedAgents.data ?? []).map((a) => a.id))
  const catalog = agentCatalog.data ?? []
  const serverMap = mcpServers.data ?? {}
  const connectorCount = CONNECTORS.filter(
    (def) => connectorState(def, serverMap) !== 'none'
  ).length

  const customModeComplete = MODES.every((m) => !!draft.customModeModels[m])
  const canContinue = step !== 'modePack' || draft.modePackId !== 'custom' || customModeComplete
  const finishing =
    complete.isPending ||
    setSetting.isPending ||
    setTokenCompression.isPending ||
    installDefaults.isPending

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
    // Apply the app-native extras first so a failure surfaces before the
    // CLI-compatible onboarding completion keys are written. All three
    // writes are idempotent (overwrites / install-if-absent).
    setExtrasError(null)
    try {
      await setSetting.mutateAsync({
        key: 'sandboxDefaults',
        value: { enabled: draft.sandboxEnabled, allowNetwork: draft.sandboxNetwork }
      })
      await setTokenCompression.mutateAsync({
        enabled: draft.compressionEnabled,
        verbosity: draft.verbosityEnabled
      })
      const toInstall = draft.subagentIds.filter((id) => !installedIds.has(id))
      if (toInstall.length > 0) {
        await installDefaults.mutateAsync({ scope: 'global', ids: toInstall })
      }
    } catch (e) {
      setExtrasError(e instanceof Error ? e.message : String(e))
      return
    }
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
      utils.agent.listModels.invalidate(),
      utils.settings.get.invalidate({ key: 'sandboxDefaults' }),
      utils.settings.get.invalidate({ key: 'tokenCompression' }),
      utils.projectConfig.agentsList.invalidate()
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
                {step === 'connectors' && 'Connect your tools'}
                {step === 'subagents' && 'Add subagents'}
                {step === 'sandbox' && 'Agent sandbox'}
                {step === 'compression' && 'Token compression'}
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
                  You can re-run this any time from Settings → About, and change everything later in
                  Settings.
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
                <div className="border-t border-border pt-3">
                  <OAuthSection />
                </div>
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
                        No packs are available because no provider is connected yet. Go back to sign
                        in, pick custom models below, or continue and set this up later.
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
                  subtitle="Observational Memory stays off unless a pack or model is set."
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

            {step === 'connectors' && (
              <div className="space-y-3">
                <div className="text-[11px] text-muted-foreground">
                  Optional: connect dev platforms so agents can use their tools. Connections apply
                  immediately (written to <code>~/.mastracode/mcp.json</code>) — you can skip this
                  and set it up later in Settings → Connectors.
                </div>
                <ConnectorsTab />
              </div>
            )}

            {step === 'subagents' && (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground">
                  Optional: add ready-made subagents the main agent can delegate to. Selected
                  templates are installed globally to <code>~/.mastracode/agents</code> when you
                  finish — all editable later in Settings → Agents.
                </div>
                {agentCatalog.isLoading && (
                  <div className="text-xs text-muted-foreground">Loading templates…</div>
                )}
                {TEMPLATE_GROUPS.map(([group, label]) => {
                  const entries = catalog.filter((t) => t.group === group)
                  if (entries.length === 0) return null
                  return (
                    <div key={group} className="space-y-2">
                      <div className="pt-1 text-[11px] font-medium text-muted-foreground">
                        {label}
                      </div>
                      {entries.map((t) => (
                        <TemplateCard
                          key={t.id}
                          selected={draft.subagentIds.includes(t.id)}
                          disabled={installedIds.has(t.id)}
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              subagentIds: d.subagentIds.includes(t.id)
                                ? d.subagentIds.filter((x) => x !== t.id)
                                : [...d.subagentIds, t.id]
                            }))
                          }
                          title={t.name}
                          subtitle={t.description}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )}

            {step === 'sandbox' && (
              <div className="space-y-3">
                <div className="text-[11px] text-muted-foreground">
                  Defaults for new chats only — each chat can override this via /sandbox or the
                  header toggle, and you can change the default in Settings → Preferences.
                </div>
                <Tip content="New chats start with OS-level isolation for agent shell commands (macOS seatbelt / Linux bubblewrap)">
                  <label className="flex w-fit items-center gap-2 text-sm">
                    <Switch
                      checked={draft.sandboxEnabled}
                      onCheckedChange={(v) => setDraft((d) => ({ ...d, sandboxEnabled: v }))}
                    />
                    Full sandbox by default (OS isolation for shell commands)
                  </label>
                </Tip>
                <Tip content="Whether sandboxed shell commands in new chats may access the network (all-or-nothing)">
                  <label className="flex w-fit items-center gap-2 text-sm">
                    <Switch
                      checked={draft.sandboxNetwork}
                      onCheckedChange={(v) => setDraft((d) => ({ ...d, sandboxNetwork: v }))}
                    />
                    Allow network in the sandbox
                  </label>
                </Tip>
              </div>
            )}

            {step === 'compression' && (
              <div className="space-y-3">
                <div className="text-[11px] text-muted-foreground">
                  Shrinks old tool outputs before each model call to cut token costs. Applies to all
                  chats — the agent can always re-run a tool if it needs the full output.
                </div>
                <Tip content="Transiently compress stale tool outputs in the prompt sent to the model — stored chat history is never modified, and the agent can fetch any compressed output back via the retrieve_full_output tool">
                  <label className="flex w-fit items-center gap-2 text-sm">
                    <Switch
                      checked={draft.compressionEnabled}
                      onCheckedChange={(v) => setDraft((d) => ({ ...d, compressionEnabled: v }))}
                    />
                    Compress old tool outputs (token savings show in /cost)
                  </label>
                </Tip>
                <Tip content="Appends a short instruction to the system prompt asking the agent not to restate tool outputs and to keep replies brief — works independently of output compression">
                  <label className="flex w-fit items-center gap-2 text-sm">
                    <Switch
                      checked={draft.verbosityEnabled}
                      onCheckedChange={(v) => setDraft((d) => ({ ...d, verbosityEnabled: v }))}
                    />
                    Verbosity steering (nudge the agent to reply concisely)
                  </label>
                </Tip>
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
                      value: connected.size > 0 ? [...connected].join(', ') : 'None connected',
                      target: 'auth' as Step
                    },
                    {
                      label: 'Model pack',
                      value: packName(draft.modePackId),
                      target: 'modePack' as Step
                    },
                    {
                      label: 'Observational Memory',
                      value: omPackName(draft.omPackId),
                      target: 'omPack' as Step
                    },
                    {
                      label: 'Connectors',
                      value: connectorCount > 0 ? `${connectorCount} configured` : 'None',
                      target: 'connectors' as Step
                    },
                    {
                      label: 'Sub-agents',
                      value:
                        draft.subagentIds.length > 0
                          ? `${draft.subagentIds.length} to add${
                              installedIds.size > 0 ? ` · ${installedIds.size} installed` : ''
                            }`
                          : installedIds.size > 0
                            ? `${installedIds.size} installed`
                            : 'None',
                      target: 'subagents' as Step
                    },
                    {
                      label: 'Sandbox default',
                      value: draft.sandboxEnabled
                        ? `On (network ${draft.sandboxNetwork ? 'allowed' : 'blocked'})`
                        : 'Off',
                      target: 'sandbox' as Step
                    },
                    {
                      label: 'Token compression',
                      value:
                        [
                          draft.compressionEnabled && 'Compression',
                          draft.verbosityEnabled && 'Verbosity steering'
                        ]
                          .filter(Boolean)
                          .join(' + ') || 'Off',
                      target: 'compression' as Step
                    },
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
                {extrasError && (
                  <div className="text-xs text-destructive selectable">{extrasError}</div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3">
            {step !== 'welcome' ? (
              <Button variant="ghost" size="sm" onClick={back} disabled={finishing}>
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
              <Button size="sm" onClick={() => void doFinish()} disabled={finishing}>
                {finishing ? 'Applying and restarting agents…' : 'Finish'}
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
