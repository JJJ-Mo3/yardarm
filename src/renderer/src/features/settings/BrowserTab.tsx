import React from 'react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { useRestartBanner } from './restart-banner'

/** A text field that saves on blur; empty clears the key (null). */
function BlurInput({
  value,
  onSave,
  placeholder,
  type = 'text'
}: {
  value: string
  onSave: (v: string | null) => void
  placeholder?: string
  type?: string
}): React.JSX.Element {
  return (
    <Input
      type={type}
      className="h-7 min-w-0 flex-1 text-[11px]"
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value.trim()
        if (v !== value) onSave(v || null)
      }}
    />
  )
}

/** Browser-automation settings in settings.json (browser_* agent tools). */
export function BrowserTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const settings = trpc.mastraSettings.get.useQuery()
  const { markDirty, banner } = useRestartBanner()

  const setBrowser = trpc.mastraSettings.setBrowserSettings.useMutation({
    onSuccess: () => {
      markDirty()
      utils.mastraSettings.get.invalidate()
    }
  })

  const b = settings.data?.browser ?? {}
  const sh = b.stagehand ?? {}
  const provider = b.provider ?? 'stagehand'
  const error = settings.error ?? setBrowser.error

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Browser automation settings stored in <code>settings.json</code>. Enables the agent&apos;s
        <code> browser_*</code> tools.
      </div>

      <label className="flex items-center gap-2 text-xs">
        <Switch
          checked={b.enabled ?? false}
          onCheckedChange={(enabled) => setBrowser.mutate({ enabled })}
        />
        Enable browser tools
      </label>

      <div className="flex items-center gap-2">
        <span className="w-28 text-[11px] text-muted-foreground">Provider</span>
        <select
          value={provider}
          onChange={(e) =>
            setBrowser.mutate({ provider: e.target.value as 'stagehand' | 'agent-browser' })
          }
          className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
        >
          <option value="stagehand">Stagehand</option>
          <option value="agent-browser">Agent browser</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <Switch
          checked={b.headless ?? false}
          onCheckedChange={(headless) => setBrowser.mutate({ headless })}
        />
        Headless
      </label>

      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-[11px] text-muted-foreground">Session scope</span>
        <Tip content="Default is a new browser per thread; a CDP URL or profile forces one shared browser">
          <select
            value={b.scope ?? ''}
            onChange={(e) =>
              setBrowser.mutate({ scope: (e.target.value || null) as 'shared' | 'thread' | null })
            }
            className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
          >
            <option value="">(default: {b.cdpUrl || b.profile ? 'shared' : 'per thread'})</option>
            <option value="shared">Shared across threads</option>
            <option value="thread">Per thread</option>
          </select>
        </Tip>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-[11px] text-muted-foreground">CDP URL</span>
        <BlurInput
          value={b.cdpUrl ?? ''}
          placeholder="connect to an existing browser"
          onSave={(v) => setBrowser.mutate({ cdpUrl: v })}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-[11px] text-muted-foreground">Profile</span>
        <BlurInput
          value={b.profile ?? ''}
          placeholder="browser profile name/dir"
          onSave={(v) => setBrowser.mutate({ profile: v })}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-[11px] text-muted-foreground">Executable path</span>
        <BlurInput
          value={b.executablePath ?? ''}
          placeholder="custom Chrome/Chromium binary"
          onSave={(v) => setBrowser.mutate({ executablePath: v })}
        />
      </div>

      {provider === 'stagehand' && (
        <div className="space-y-2 rounded border border-border p-2">
          <div className="text-xs font-medium">Stagehand</div>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-[11px] text-muted-foreground">Environment</span>
            <select
              value={sh.env ?? 'LOCAL'}
              onChange={(e) =>
                setBrowser.mutate({ stagehand: { env: e.target.value as 'LOCAL' | 'BROWSERBASE' } })
              }
              className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
            >
              <option value="LOCAL">Local browser</option>
              <option value="BROWSERBASE">Browserbase (cloud)</option>
            </select>
          </div>
          {sh.env === 'BROWSERBASE' && (
            <>
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-[11px] text-muted-foreground">API key</span>
                <BlurInput
                  type="password"
                  value={sh.apiKey ?? ''}
                  placeholder="Browserbase API key"
                  onSave={(v) => setBrowser.mutate({ stagehand: { apiKey: v } })}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-[11px] text-muted-foreground">Project id</span>
                <BlurInput
                  value={sh.projectId ?? ''}
                  placeholder="Browserbase project id"
                  onSave={(v) => setBrowser.mutate({ stagehand: { projectId: v } })}
                />
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Switch
              checked={sh.preserveUserDataDir ?? false}
              onCheckedChange={(v) => setBrowser.mutate({ stagehand: { preserveUserDataDir: v } })}
            />
            Preserve user data dir between sessions
          </label>
        </div>
      )}

      {provider === 'agent-browser' && (
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-[11px] text-muted-foreground">Storage state</span>
          <BlurInput
            value={b.agentBrowser?.storageState ?? ''}
            placeholder="path to storage-state JSON"
            onSave={(v) => setBrowser.mutate({ agentBrowser: { storageState: v } })}
          />
        </div>
      )}

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}
      {banner}
    </div>
  )
}
