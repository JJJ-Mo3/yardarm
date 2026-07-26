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

  // Yardarm-native new-chat defaults for full sandbox mode (app_settings KV).
  const sandboxDefaults = trpc.settings.get.useQuery({ key: 'sandboxDefaults' })
  const setSetting = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'sandboxDefaults' })
  })
  const sd = (sandboxDefaults.data as { enabled?: boolean; allowNetwork?: boolean } | null) ?? {}
  const sandboxEnabled = sd.enabled === true
  const sandboxNetwork = sd.allowNetwork !== false

  // Global token-compression settings (apply to all chats, live immediately).
  const tokenCompression = trpc.settings.get.useQuery({ key: 'tokenCompression' })
  const setTokenCompression = trpc.agent.setTokenCompression.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'tokenCompression' })
  })
  const tc = (tokenCompression.data as { enabled?: boolean; verbosity?: boolean } | null) ?? {}
  const compressionEnabled = tc.enabled === true
  const verbosityEnabled = tc.verbosity === true

  const p = settings.data?.preferences ?? {}
  const error =
    settings.error ?? setPreferences.error ?? setSetting.error ?? setTokenCompression.error

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
            placeholder="2 (default)"
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

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Agent sandbox</div>
          <div className="text-[11px] text-muted-foreground">
            Yardarm defaults for new chats only — existing chats keep their own setting (change it
            per chat via /sandbox).
          </div>
        </div>
        <Tip content="New chats start with OS-level isolation for agent shell commands (macOS seatbelt / Linux bubblewrap)">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={sandboxEnabled}
              onCheckedChange={(v) =>
                setSetting.mutate({
                  key: 'sandboxDefaults',
                  value: { enabled: v, allowNetwork: sandboxNetwork }
                })
              }
            />
            Full sandbox by default (OS isolation for shell commands)
          </label>
        </Tip>
        <Tip content="Whether sandboxed shell commands in new chats may access the network (all-or-nothing)">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={sandboxNetwork}
              onCheckedChange={(v) =>
                setSetting.mutate({
                  key: 'sandboxDefaults',
                  value: { enabled: sandboxEnabled, allowNetwork: v }
                })
              }
            />
            Allow network in the sandbox
          </label>
        </Tip>
      </div>

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Token compression</div>
          <div className="text-[11px] text-muted-foreground">
            Shrinks old tool outputs before each model call to cut token costs. Applies to all chats
            immediately — the agent can always re-run a tool if it needs the full output.
          </div>
        </div>
        <Tip content="Transiently compress stale tool outputs in the prompt sent to the model — stored chat history is never modified, and the agent can fetch any compressed output back via the retrieve_full_output tool">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={compressionEnabled}
              disabled={setTokenCompression.isPending}
              onCheckedChange={(v) =>
                setTokenCompression.mutate({ enabled: v, verbosity: verbosityEnabled })
              }
            />
            Compress old tool outputs (token savings show in /cost)
          </label>
        </Tip>
        <Tip content="Appends a short instruction to the system prompt asking the agent not to restate tool outputs and to keep replies brief — works independently of output compression">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={verbosityEnabled}
              disabled={setTokenCompression.isPending}
              onCheckedChange={(v) =>
                setTokenCompression.mutate({ enabled: compressionEnabled, verbosity: v })
              }
            />
            Verbosity steering (nudge the agent to reply concisely)
          </label>
        </Tip>
      </div>

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}
      {banner}
    </div>
  )
}
