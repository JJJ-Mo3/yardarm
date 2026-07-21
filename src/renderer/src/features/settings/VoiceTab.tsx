import React from 'react'
import { trpc } from '../../lib/trpc'
import { Switch } from '../../components/ui/switch'
import { useRestartBanner } from './restart-banner'

/**
 * Voice (speech-to-text) settings in settings.json, shared with the mastracode
 * CLI. With the Cloud engine the composer mic button dictates into the prompt;
 * macOS native dictation runs only in the CLI (/voice).
 */
export function VoiceTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const settings = trpc.mastraSettings.get.useQuery()
  const registry = trpc.mastraSettings.sttRegistry.useQuery(undefined, { staleTime: 60_000 })
  const { markDirty, banner } = useRestartBanner()

  const setVoice = trpc.mastraSettings.setVoiceSettings.useMutation({
    onSuccess: () => {
      markDirty()
      utils.mastraSettings.get.invalidate()
    }
  })

  const v = settings.data?.voice ?? {}
  const models = registry.data ?? []
  const providers = [...new Set(models.map((m) => m.provider))]
  const provider = v.provider ?? providers[0] ?? ''
  const providerModels = models.filter((m) => m.provider === provider)
  const error = settings.error ?? registry.error ?? setVoice.error

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Dictation settings stored in <code>settings.json</code>, shared with the mastracode CLI.
        With the Cloud engine, the mic button in the composer dictates into the prompt; macOS native
        dictation runs only in the CLI (<code>/voice</code>).
      </div>

      <label className="flex items-center gap-2 text-xs">
        <Switch
          checked={v.enabled ?? false}
          onCheckedChange={(enabled) => setVoice.mutate({ enabled })}
        />
        Enable voice input
      </label>

      <div className="flex items-center gap-2">
        <span className="w-24 text-[11px] text-muted-foreground">Engine</span>
        <select
          value={v.engine ?? 'macos-native'}
          onChange={(e) => setVoice.mutate({ engine: e.target.value as 'macos-native' | 'cloud' })}
          className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
        >
          <option value="macos-native">macOS native dictation</option>
          <option value="cloud">Cloud transcription</option>
        </select>
      </div>

      {(v.engine ?? 'macos-native') === 'cloud' && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-muted-foreground">Provider</span>
            <select
              value={provider}
              onChange={(e) => setVoice.mutate({ provider: e.target.value, model: null })}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px]"
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-muted-foreground">Model</span>
            <select
              value={v.model ?? ''}
              onChange={(e) => setVoice.mutate({ model: e.target.value || null })}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px]"
            >
              <option value="">(default: {providerModels[0]?.label ?? 'provider default'})</option>
              {providerModels.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Cloud transcription uses the provider&apos;s API key from the API Keys tab.
          </div>
        </>
      )}

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}
      {banner}
    </div>
  )
}
