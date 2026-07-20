import React from 'react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { useRestartBanner } from './restart-banner'

const THEMES = ['auto', 'dark', 'light'] as const
const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh'] as const

/** mastracode preferences in settings.json (shared with the CLI). */
export function PreferencesTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const settings = trpc.mastraSettings.get.useQuery()
  const { markDirty, banner } = useRestartBanner()

  const setPreferences = trpc.mastraSettings.setPreferences.useMutation({
    onSuccess: () => {
      markDirty()
      utils.mastraSettings.get.invalidate()
    }
  })

  const p = settings.data?.preferences ?? {}
  const error = settings.error ?? setPreferences.error

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        mastracode preferences stored in <code>settings.json</code> (shared with the CLI). These set
        defaults for new agent sessions; the app theme above is separate.
      </div>

      <Tip content="New sessions start with every tool call auto-approved — the agent never asks for permission">
        <label className="flex w-fit items-center gap-2 text-xs">
          <Switch
            checked={p.yolo ?? false}
            onCheckedChange={(v) => setPreferences.mutate({ yolo: v })}
          />
          YOLO mode by default (auto-approve all tools)
        </label>
      </Tip>

      <div className="flex items-center gap-2">
        <span className="w-28 text-[11px] text-muted-foreground">CLI theme</span>
        <Tip content="Color theme for the mastracode CLI (does not affect this app's theme)">
          <select
            value={p.theme ?? 'auto'}
            onChange={(e) =>
              setPreferences.mutate({ theme: e.target.value as (typeof THEMES)[number] })
            }
            className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Tip>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-28 text-[11px] text-muted-foreground">Thinking level</span>
        <Tip content="Default reasoning effort for new sessions — higher levels think longer before answering">
          <select
            value={p.thinkingLevel ?? 'off'}
            onChange={(e) =>
              setPreferences.mutate({
                thinkingLevel: e.target.value as (typeof THINKING_LEVELS)[number]
              })
            }
            className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
          >
            {THINKING_LEVELS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Tip>
      </div>

      <Tip content="Collapse tool output in the CLI transcript to short previews">
        <label className="flex w-fit items-center gap-2 text-xs">
          <Switch
            checked={p.quietMode ?? false}
            onCheckedChange={(v) => setPreferences.mutate({ quietMode: v })}
          />
          Quiet mode (collapse tool output previews)
        </label>
      </Tip>

      <div className="flex items-center gap-2">
        <span className="w-28 text-[11px] text-muted-foreground">Max preview lines</span>
        <Tip content="How many lines of tool output to show in quiet mode before truncating">
          <Input
            type="number"
            min={0}
            className="h-7 w-24 text-[11px]"
            defaultValue={p.quietModeMaxToolPreviewLines ?? ''}
            placeholder="default"
            onBlur={(e) => {
              const v = e.target.value.trim()
              const n = v ? Math.max(0, Math.floor(Number(v))) : undefined
              if (n !== undefined && n !== p.quietModeMaxToolPreviewLines) {
                setPreferences.mutate({ quietModeMaxToolPreviewLines: n })
              }
            }}
          />
        </Tip>
      </div>

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}
      {banner}
    </div>
  )
}
