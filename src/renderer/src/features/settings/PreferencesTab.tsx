import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { useRestartBanner } from './restart-banner'

const THEMES = ['auto', 'dark', 'light'] as const
const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh'] as const

/**
 * Globally disable individual agent tools (SDK `disabledTools`). Edits are
 * drafted locally and applied in one shot because applying restarts every
 * running agent host.
 */
function ToolsSection(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const utils = trpc.useUtils()
  const saved = trpc.agent.getDisabledTools.useQuery()
  // Enumerating tools boots an agent host — only fetch once the section is opened.
  const categories = trpc.agent.listToolNames.useQuery(undefined, { enabled: open })
  const setDisabledTools = trpc.agent.setDisabledTools.useMutation({
    onSuccess: () => {
      setDraft(null)
      utils.agent.getDisabledTools.invalidate()
    }
  })

  const savedSet = new Set(saved.data ?? [])
  const current = draft ?? savedSet
  const dirty =
    draft !== null && (draft.size !== savedSet.size || [...draft].some((t) => !savedSet.has(t)))

  const toggle = (tool: string, enabled: boolean): void => {
    const next = new Set(current)
    if (enabled) next.delete(tool)
    else next.add(tool)
    setDraft(next)
  }

  return (
    <div className="space-y-3 rounded border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-xs font-medium">Agent tools</div>
          <div className="text-[11px] text-muted-foreground">
            Remove individual tools from every agent&apos;s tool set (all projects and chats).
            Applying restarts running agents.
          </div>
        </div>
        <Tip content={open ? 'Hide the tool list' : 'Show every agent tool grouped by category'}>
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {savedSet.size > 0 ? `Tools (${savedSet.size} disabled)` : 'Tools'}
          </Button>
        </Tip>
      </div>

      {open && categories.isLoading && (
        <div className="text-[11px] text-muted-foreground">Loading tools…</div>
      )}
      {open && categories.error && (
        <div className="text-xs text-destructive selectable">{categories.error.message}</div>
      )}
      {open &&
        (categories.data ?? []).map((cat) => (
          <div key={cat.category} className="space-y-1.5">
            <div className="text-[11px] font-medium">
              {cat.label}
              <span className="ml-1.5 font-normal text-muted-foreground">{cat.description}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {cat.tools.map((tool) => (
                <Tip
                  key={tool}
                  content={
                    current.has(tool)
                      ? `Re-enable the ${tool} tool for all agents`
                      : `Disable the ${tool} tool for all agents`
                  }
                >
                  <label className="flex w-fit items-center gap-2 text-[11px]">
                    <Switch checked={!current.has(tool)} onCheckedChange={(v) => toggle(tool, v)} />
                    <span className="font-mono">{tool}</span>
                  </label>
                </Tip>
              ))}
            </div>
          </div>
        ))}

      {open && (
        <div className="flex items-center gap-2">
          <Tip content="Save the tool changes and restart all running agents to apply them">
            <span className="inline-flex">
              <Button
                size="sm"
                disabled={!dirty || setDisabledTools.isPending}
                onClick={() => setDisabledTools.mutate({ tools: [...current].sort() })}
              >
                Apply (restarts agents)
              </Button>
            </span>
          </Tip>
          <Tip content="Discard unapplied tool changes">
            <span className="inline-flex">
              <Button variant="outline" size="sm" disabled={!dirty} onClick={() => setDraft(null)}>
                Revert
              </Button>
            </span>
          </Tip>
          {setDisabledTools.error && (
            <div className="text-xs text-destructive selectable">
              {setDisabledTools.error.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

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

      <ToolsSection />

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}
      {banner}
    </div>
  )
}
