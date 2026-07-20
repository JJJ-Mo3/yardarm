import React, { useState } from 'react'
import { useSetAtom } from 'jotai'
import { KeyRound, Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { settingsTabAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { ModelSelect } from '../../components/ModelSelect'

const MODES = ['build', 'plan', 'fast'] as const
const SUBAGENT_TYPES = ['explore', 'plan', 'general'] as const

/** Mirrors vendored @mastra/code-sdk dist/agents/modes/{build,plan,explore}.js defaultModelId. */
const BUILTIN_MODE_DEFAULTS: Record<string, string> = {
  build: 'openai/gpt-5.5',
  plan: 'openai/gpt-5.5',
  fast: 'openai/gpt-5.4-mini'
}

/** Which mode's default each subagent type inherits when unset. */
const SUBAGENT_MODE: Record<(typeof SUBAGENT_TYPES)[number], string> = {
  explore: 'fast',
  plan: 'plan',
  general: 'build'
}

/**
 * Floor for the OM observe/reflect thresholds. The SDK derives its working
 * buffer as 20% of this value (and keeps a 2000-token activation window under
 * it), so tiny values make Memory throw "bufferTokens must be > 0" on every
 * message. SDK defaults are 30000 / 40000.
 */
const OM_THRESHOLD_MIN = 1000

/** Parse an OM threshold input: empty → null (use default), else clamp to the floor. */
function clampOmThreshold(raw: string): number | null {
  const v = raw.trim()
  if (!v) return null
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.max(n, OM_THRESHOLD_MIN)
}

export function ModelsTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const settings = trpc.mastraSettings.get.useQuery()
  const models = trpc.agent.listModels.useQuery(undefined, { staleTime: 60_000 })
  const packs = trpc.mastraSettings.listPacks.useQuery(undefined, { staleTime: 60_000 })
  const [dirty, setDirty] = useState(false)
  const [packName, setPackName] = useState('')

  const onSaved = (): void => {
    setDirty(true)
    utils.mastraSettings.get.invalidate()
    utils.mastraSettings.listPacks.invalidate()
  }
  const setModeDefault = trpc.mastraSettings.setModeDefault.useMutation({ onSuccess: onSaved })
  const setSubagentModel = trpc.mastraSettings.setSubagentModel.useMutation({ onSuccess: onSaved })
  const setGoalDefaults = trpc.mastraSettings.setGoalDefaults.useMutation({ onSuccess: onSaved })
  const setOmDefaults = trpc.mastraSettings.setOmDefaults.useMutation({ onSuccess: onSaved })
  const setActiveModelPack = trpc.mastraSettings.setActiveModelPack.useMutation({
    onSuccess: onSaved
  })
  const setOmPack = trpc.mastraSettings.setOmPack.useMutation({ onSuccess: onSaved })
  const saveCustomPack = trpc.mastraSettings.saveCustomPack.useMutation({
    onSuccess: () => {
      setPackName('')
      onSaved()
    }
  })
  const deleteCustomPack = trpc.mastraSettings.deleteCustomPack.useMutation({ onSuccess: onSaved })
  const applyRestart = trpc.mastraSettings.applyRestart.useMutation({
    onSuccess: () => {
      setDirty(false)
      // Fresh hosts re-read settings.json at boot — refetch the model catalog.
      utils.agent.listModels.invalidate()
    }
  })

  const s = settings.data ?? {}
  const m = s.models ?? {}
  const modelList = models.data ?? []
  const modePacks = packs.data?.modePacks ?? []
  const omPacks = packs.data?.omPacks ?? []
  const customPacks = s.customModelPacks ?? []

  // Resolved defaults shown in placeholders: active pack model, else SDK built-in.
  const activePack = modePacks.find((p) => p.id === m.activeModelPackId)
  const modeDefaultFor = (mode: string): string =>
    activePack?.models[mode] ?? BUILTIN_MODE_DEFAULTS[mode] ?? 'built-in'
  const activeOmPack = omPacks.find((p) => p.id === m.activeOmPackId)
  const omDefault = activeOmPack?.modelId ?? m.omModelOverride ?? null

  const error =
    settings.error ??
    setModeDefault.error ??
    setSubagentModel.error ??
    setGoalDefaults.error ??
    setOmDefaults.error ??
    setActiveModelPack.error ??
    setOmPack.error ??
    saveCustomPack.error ??
    deleteCustomPack.error ??
    applyRestart.error

  return (
    <div className="space-y-5">
      <div className="text-[11px] text-muted-foreground">
        Global defaults stored in mastracode&apos;s <code>settings.json</code> (shared with the
        CLI). Changes apply to agents on restart.
      </div>

      {models.error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-[11px] text-destructive">
          <span className="min-w-0 flex-1 selectable">
            Could not load the model catalog: {models.error.message}
          </span>
          <Button size="sm" variant="outline" onClick={() => models.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {models.data && modelList.length > 0 && !modelList.some((mm) => mm.hasApiKey) && (
        <div className="flex items-center gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
          <KeyRound size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">
            No provider is authenticated yet — add an API key or log in to enable models.
          </span>
          <Tip content="Store a provider API key under Settings → API Keys">
            <Button size="sm" variant="outline" onClick={() => setSettingsTab('keys')}>
              API Keys
            </Button>
          </Tip>
          <Tip content="Log in with a provider subscription under Settings → Providers">
            <Button size="sm" variant="outline" onClick={() => setSettingsTab('providers')}>
              Log in
            </Button>
          </Tip>
        </div>
      )}

      {/* Model packs */}
      <div>
        <div className="mb-1.5 text-xs font-medium">Model pack</div>
        <div className="space-y-1.5">
          <select
            value={m.activeModelPackId ?? ''}
            onChange={(e) => {
              const packId = e.target.value || null
              const pack = modePacks.find((p) => p.id === packId)
              setActiveModelPack.mutate({
                packId,
                packModels: packId?.startsWith('custom:') ? pack?.models : undefined
              })
            }}
            className="h-7 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[11px]"
          >
            <option value="">(none — manual defaults below)</option>
            {modePacks.map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.name}
              </option>
            ))}
          </select>
          {m.activeModelPackId && (
            <div className="text-[11px] text-muted-foreground">
              {modePacks.find((p) => p.id === m.activeModelPackId)?.description ??
                'Pack models resolve when agents boot.'}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              className="h-7 flex-1 text-[11px]"
              placeholder="Save current mode defaults as custom pack…"
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
            />
            <Tip content="Save the current per-mode defaults as a reusable custom pack">
              <span className="inline-flex">
                <Button
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={
                    !packName.trim() ||
                    !Object.keys(m.modeDefaults ?? {}).length ||
                    saveCustomPack.isPending
                  }
                  onClick={() =>
                    saveCustomPack.mutate({ name: packName.trim(), models: m.modeDefaults ?? {} })
                  }
                >
                  Save pack
                </Button>
              </span>
            </Tip>
          </div>
          {customPacks.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-2 rounded border border-border px-2 py-1"
            >
              <span className="flex-1 text-[11px]">{p.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {Object.keys(p.models).length} models
              </span>
              <Tip content="Delete this custom pack">
                <button
                  className="text-muted-foreground hover:text-destructive cursor-pointer"
                  onClick={() => deleteCustomPack.mutate({ name: p.name })}
                >
                  <Trash2 size={12} />
                </button>
              </Tip>
            </div>
          ))}
        </div>
      </div>

      {/* Per-mode defaults */}
      <div>
        <div className="mb-1.5 text-xs font-medium">Default model per mode</div>
        {m.activeModelPackId && (
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            Active pack: <code>{m.activeModelPackId}</code> — setting a mode default switches to
            manual overrides.
          </div>
        )}
        <div className="space-y-1.5">
          {MODES.map((mode) => (
            <div key={mode} className="flex items-center gap-2">
              <span className="w-16 text-[11px] capitalize text-muted-foreground">{mode}</span>
              <ModelSelect
                value={m.modeDefaults?.[mode] ?? ''}
                onChange={(v) => setModeDefault.mutate({ mode, modelId: v || null })}
                models={modelList}
                placeholder={`(default: ${modeDefaultFor(mode)})`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Subagent models */}
      <div>
        <div className="mb-1.5 text-xs font-medium">Subagent models</div>
        <div className="space-y-1.5">
          {SUBAGENT_TYPES.map((agentType) => (
            <div key={agentType} className="flex items-center gap-2">
              <span className="w-16 text-[11px] capitalize text-muted-foreground">{agentType}</span>
              <ModelSelect
                value={m.subagentModels?.[agentType] ?? ''}
                onChange={(v) => setSubagentModel.mutate({ agentType, modelId: v || null })}
                models={modelList}
                placeholder={`(default: ${modeDefaultFor(SUBAGENT_MODE[agentType])})`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Goal defaults */}
      <div>
        <div className="mb-1.5 text-xs font-medium">Goal judge (/goal)</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Judge</span>
            <ModelSelect
              value={m.goalJudgeModel ?? ''}
              onChange={(v) => setGoalDefaults.mutate({ judgeModel: v || null })}
              models={modelList}
              placeholder="(default: chat model)"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Max turns</span>
            <Tip content="Maximum agent runs before a goal pauses (empty = default 50)">
              <Input
                type="number"
                min={1}
                className="h-7 w-24 text-[11px]"
                defaultValue={m.goalMaxTurns ?? ''}
                placeholder="50 (default)"
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  const n = v ? Number(v) : null
                  if (n !== (m.goalMaxTurns ?? null)) {
                    setGoalDefaults.mutate({ maxTurns: n && n > 0 ? Math.floor(n) : null })
                  }
                }}
              />
            </Tip>
          </div>
        </div>
      </div>

      {/* Observational Memory defaults */}
      <div>
        <div className="mb-1.5 text-xs font-medium">Observational Memory defaults (/om)</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">OM pack</span>
            <select
              value={m.activeOmPackId ?? ''}
              onChange={(e) => setOmPack.mutate({ packId: e.target.value || null })}
              className="h-7 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[11px]"
            >
              <option value="">(none — manual overrides below)</option>
              {omPacks.map((p) => (
                <option key={p.id} value={p.id} title={p.description}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">OM model</span>
            <ModelSelect
              value={m.omModelOverride ?? ''}
              onChange={(v) => setOmDefaults.mutate({ omModelOverride: v || null })}
              models={modelList}
              placeholder={omDefault ? `(default: ${omDefault})` : '(off — no OM model set)'}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Observer</span>
            <ModelSelect
              value={m.observerModelOverride ?? ''}
              onChange={(v) => setOmDefaults.mutate({ observerModelOverride: v || null })}
              models={modelList}
              placeholder={omDefault ? `(default: ${omDefault})` : '(off — no OM model set)'}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Reflector</span>
            <ModelSelect
              value={m.reflectorModelOverride ?? ''}
              onChange={(v) => setOmDefaults.mutate({ reflectorModelOverride: v || null })}
              models={modelList}
              placeholder={omDefault ? `(default: ${omDefault})` : '(off — no OM model set)'}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Observe @</span>
            <Tip
              content={`Observation token threshold (min ${OM_THRESHOLD_MIN}; empty = default 30000)`}
            >
              <Input
                type="number"
                min={OM_THRESHOLD_MIN}
                step={1000}
                className="h-7 w-24 text-[11px]"
                defaultValue={m.omObservationThreshold ?? ''}
                placeholder="30000"
                onBlur={(e) => {
                  const n = clampOmThreshold(e.target.value)
                  if (n !== null) e.target.value = String(n)
                  if (n !== (m.omObservationThreshold ?? null)) {
                    setOmDefaults.mutate({ omObservationThreshold: n })
                  }
                }}
              />
            </Tip>
            <span className="w-16 text-[11px] text-muted-foreground">Reflect @</span>
            <Tip
              content={`Reflection token threshold (min ${OM_THRESHOLD_MIN}; empty = default 40000)`}
            >
              <Input
                type="number"
                min={OM_THRESHOLD_MIN}
                step={1000}
                className="h-7 w-24 text-[11px]"
                defaultValue={m.omReflectionThreshold ?? ''}
                placeholder="40000"
                onBlur={(e) => {
                  const n = clampOmThreshold(e.target.value)
                  if (n !== null) e.target.value = String(n)
                  if (n !== (m.omReflectionThreshold ?? null)) {
                    setOmDefaults.mutate({ omReflectionThreshold: n })
                  }
                }}
              />
            </Tip>
          </div>
          <Tip content="Store observations in terse shorthand to use fewer tokens">
            <label className="flex w-fit items-center gap-2 text-[11px] text-muted-foreground">
              <Switch
                checked={m.omCavemanObservations ?? false}
                onCheckedChange={(v) => setOmDefaults.mutate({ omCavemanObservations: v })}
              />
              Terse (caveman-style) observations
            </label>
          </Tip>
        </div>
      </div>

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}

      {dirty && (
        <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <span className="flex-1 text-[11px]">Saved. Restart agents to apply.</span>
          <Tip content="Restart all agent processes now so the saved defaults take effect">
            <span className="inline-flex">
              <Button
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={applyRestart.isPending}
                onClick={() => applyRestart.mutate()}
              >
                Restart agents
              </Button>
            </span>
          </Tip>
        </div>
      )}
    </div>
  )
}
