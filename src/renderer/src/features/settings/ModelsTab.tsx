import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'

const MODES = ['build', 'plan', 'fast'] as const
const SUBAGENT_TYPES = ['explore', 'plan', 'general'] as const

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

export function ModelsTab(): React.JSX.Element {
  const utils = trpc.useUtils()
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
    onSuccess: () => setDirty(false)
  })

  const s = settings.data ?? {}
  const m = s.models ?? {}
  const modelList = models.data ?? []
  const modePacks = packs.data?.modePacks ?? []
  const omPacks = packs.data?.omPacks ?? []
  const customPacks = s.customModelPacks ?? []

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
              <button
                title="Delete custom pack"
                className="text-muted-foreground hover:text-destructive cursor-pointer"
                onClick={() => deleteCustomPack.mutate({ name: p.name })}
              >
                <Trash2 size={12} />
              </button>
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
                placeholder="(pack / built-in default)"
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
              <span className="w-16 text-[11px] capitalize text-muted-foreground">
                {agentType}
              </span>
              <ModelSelect
                value={m.subagentModels?.[agentType] ?? ''}
                onChange={(v) => setSubagentModel.mutate({ agentType, modelId: v || null })}
                models={modelList}
                placeholder="(inherit)"
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
              placeholder="(default)"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Max turns</span>
            <Input
              type="number"
              min={1}
              className="h-7 w-24 text-[11px]"
              defaultValue={m.goalMaxTurns ?? ''}
              placeholder="default"
              onBlur={(e) => {
                const v = e.target.value.trim()
                const n = v ? Number(v) : null
                if (n !== (m.goalMaxTurns ?? null)) {
                  setGoalDefaults.mutate({ maxTurns: n && n > 0 ? Math.floor(n) : null })
                }
              }}
            />
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
              placeholder="(pack / default)"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Observer</span>
            <ModelSelect
              value={m.observerModelOverride ?? ''}
              onChange={(v) => setOmDefaults.mutate({ observerModelOverride: v || null })}
              models={modelList}
              placeholder="(pack / default)"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Reflector</span>
            <ModelSelect
              value={m.reflectorModelOverride ?? ''}
              onChange={(v) => setOmDefaults.mutate({ reflectorModelOverride: v || null })}
              models={modelList}
              placeholder="(pack / default)"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[11px] text-muted-foreground">Observe @</span>
            <Input
              type="number"
              min={1}
              className="h-7 w-24 text-[11px]"
              defaultValue={m.omObservationThreshold ?? ''}
              placeholder="default"
              title="Observation token threshold"
              onBlur={(e) => {
                const v = e.target.value.trim()
                const n = v ? Number(v) : null
                if (n !== (m.omObservationThreshold ?? null)) {
                  setOmDefaults.mutate({ omObservationThreshold: n && n > 0 ? n : null })
                }
              }}
            />
            <span className="w-16 text-[11px] text-muted-foreground">Reflect @</span>
            <Input
              type="number"
              min={1}
              className="h-7 w-24 text-[11px]"
              defaultValue={m.omReflectionThreshold ?? ''}
              placeholder="default"
              title="Reflection token threshold"
              onBlur={(e) => {
                const v = e.target.value.trim()
                const n = v ? Number(v) : null
                if (n !== (m.omReflectionThreshold ?? null)) {
                  setOmDefaults.mutate({ omReflectionThreshold: n && n > 0 ? n : null })
                }
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Switch
              checked={m.omCavemanObservations ?? false}
              onCheckedChange={(v) => setOmDefaults.mutate({ omCavemanObservations: v })}
            />
            Terse (caveman-style) observations
          </label>
        </div>
      </div>

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}

      {dirty && (
        <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <span className="flex-1 text-[11px]">Saved. Restart agents to apply.</span>
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={applyRestart.isPending}
            onClick={() => applyRestart.mutate()}
          >
            Restart agents
          </Button>
        </div>
      )}
    </div>
  )
}
