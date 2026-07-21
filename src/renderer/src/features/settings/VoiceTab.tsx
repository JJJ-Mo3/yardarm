import React from 'react'
import { useSetAtom } from 'jotai'
import { KeyRound } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { settingsTabAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
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

  const setSettingsTab = useSetAtom(settingsTabAtom)

  const v = settings.data?.voice ?? {}
  const models = registry.data ?? []
  const providers = [...new Set(models.map((m) => m.provider))]
  const provider = v.provider ?? providers[0] ?? ''
  const providerModels = models.filter((m) => m.provider === provider)
  const error = settings.error ?? registry.error ?? setVoice.error

  // Cloud transcription only works with an API key (env var or stored key —
  // STT endpoints reject OAuth tokens), so a key is a prerequisite for
  // enabling. Gate all blocking on keysKnown so a loading/errored registry
  // never falsely locks the UI.
  const cloud = (v.engine ?? 'macos-native') === 'cloud'
  const keysKnown = registry.isSuccess
  const providerHasKey = models.some((m) => m.provider === provider && m.hasKey)
  const anyKey = models.some((m) => m.hasKey)
  const envVar = models.find((m) => m.provider === provider)?.envVar
  const enableBlocked = !(v.enabled ?? false) && cloud && keysKnown && !providerHasKey

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Dictation settings stored in <code>settings.json</code>, shared with the mastracode CLI.
        With the Cloud engine, the mic button in the composer dictates into the prompt; macOS native
        dictation runs only in the CLI (<code>/voice</code>).
      </div>

      <label className="flex items-center gap-2 text-xs">
        <Tip
          content={
            enableBlocked
              ? `Add a ${provider} API key first — cloud transcription requires one (OAuth logins don't work).`
              : 'Turn voice dictation on or off (shared with the mastracode CLI)'
          }
        >
          <span className="inline-flex">
            <Switch
              checked={v.enabled ?? false}
              disabled={enableBlocked}
              onCheckedChange={(enabled) => setVoice.mutate({ enabled })}
            />
          </span>
        </Tip>
        Enable voice input
      </label>

      <div className="flex items-center gap-2">
        <span className="w-24 text-[11px] text-muted-foreground">Engine</span>
        <Tip content="Where dictation runs: macOS native (CLI only) or a cloud STT provider (usable in-app)">
          <select
            value={v.engine ?? 'macos-native'}
            onChange={(e) =>
              setVoice.mutate({ engine: e.target.value as 'macos-native' | 'cloud' })
            }
            className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
          >
            <option value="macos-native">macOS native dictation</option>
            <option value="cloud" disabled={keysKnown && !anyKey}>
              Cloud transcription{keysKnown && !anyKey ? ' (needs an API key)' : ''}
            </option>
          </select>
        </Tip>
      </div>

      {cloud && (
        <>
          {keysKnown && !providerHasKey && (
            <div className="flex items-center gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
              <KeyRound size={13} className="shrink-0" />
              <span className="min-w-0 flex-1">
                No {provider} API key — cloud transcription needs one. Add it under API Keys
                {envVar ? ` or set ${envVar}` : ''}.
              </span>
              <Tip content="Store a provider API key under Settings → API Keys">
                <Button size="sm" variant="outline" onClick={() => setSettingsTab('keys')}>
                  API Keys
                </Button>
              </Tip>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-muted-foreground">Provider</span>
            <Tip content="Cloud STT provider used for dictation (needs its API key)">
              <select
                value={provider}
                onChange={(e) => setVoice.mutate({ provider: e.target.value, model: null })}
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px]"
              >
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                    {keysKnown && !models.some((m) => m.provider === p && m.hasKey)
                      ? ' — no key'
                      : ''}
                  </option>
                ))}
              </select>
            </Tip>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-muted-foreground">Model</span>
            <Tip content="Transcription model — leave on default unless the provider offers a better fit">
              <select
                value={v.model ?? ''}
                onChange={(e) => setVoice.mutate({ model: e.target.value || null })}
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px]"
              >
                <option value="">
                  (default: {providerModels[0]?.label ?? 'provider default'})
                </option>
                {providerModels.map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Tip>
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
