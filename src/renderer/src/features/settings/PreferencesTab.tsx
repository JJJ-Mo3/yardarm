import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { THINKING_LEVELS } from '../../../../shared/mastra-settings'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { PruneStorageDialog } from './PruneStorageDialog'
import { useRestartBanner } from './restart-banner'

const THEMES = ['auto', 'dark', 'light'] as const
const WEB_SEARCH_PROVIDERS = ['auto', 'tavily', 'parallel'] as const

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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** On-disk storage sizes with a shortcut to the shared prune dialog. */
function StorageSection(): React.JSX.Element {
  const [pruneOpen, setPruneOpen] = useState(false)
  const utils = trpc.useUtils()
  const info = trpc.system.storageInfo.useQuery(undefined, { staleTime: 30_000 })

  return (
    <div className="space-y-3 rounded border border-border p-3">
      <div>
        <div className="text-xs font-medium">Storage</div>
        <div className="text-[11px] text-muted-foreground">
          Disk space used by mastracode&apos;s local data (threads, traces, memory — shared with the
          CLI) and by Yardarm&apos;s own chat database.
        </div>
      </div>
      <div className="space-y-1 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-40 text-muted-foreground">mastracode storage</span>
          <span className="font-mono">{info.data ? formatBytes(info.data.mastraBytes) : '…'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-40 text-muted-foreground">Yardarm chat database</span>
          <span className="font-mono">{info.data ? formatBytes(info.data.appDbBytes) : '…'}</span>
        </div>
      </div>
      <Tip content="Delete old threads, traces and logs from mastracode storage (stops running agents while pruning)">
        <span className="inline-flex">
          <Button variant="outline" size="sm" onClick={() => setPruneOpen(true)}>
            Prune now
          </Button>
        </span>
      </Tip>
      {info.error && (
        <div className="text-xs text-destructive selectable">{info.error.message}</div>
      )}
      <PruneStorageDialog
        open={pruneOpen}
        onOpenChange={(open) => {
          setPruneOpen(open)
          if (!open) utils.system.storageInfo.invalidate()
        }}
      />
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

  const setCrossAgent = trpc.mastraSettings.setCrossAgentSignals.useMutation({
    onSuccess: () => {
      markDirty()
      utils.mastraSettings.get.invalidate()
    }
  })

  const setScheduleTools = trpc.mastraSettings.setScheduleTools.useMutation({
    onSuccess: () => {
      markDirty()
      utils.mastraSettings.get.invalidate()
    }
  })

  const setKnowledgeEnabled = trpc.mastraSettings.setKnowledgeEnabled.useMutation({
    onSuccess: () => {
      markDirty()
      utils.mastraSettings.get.invalidate()
    }
  })

  const setExperimentalAgent = trpc.mastraSettings.setExperimentalAgent.useMutation({
    onSuccess: () => {
      markDirty()
      utils.mastraSettings.get.invalidate()
    }
  })
  const rawExperimentalAgent = settings.data?.experimentalAgent
  const experimentalAgent =
    rawExperimentalAgent === 'durable' || rawExperimentalAgent === 'evented'
      ? rawExperimentalAgent
      : 'off'

  // Desktop notifications for background agent activity (app_settings KV,
  // read by the main process at notify time; absent means enabled).
  const desktopNotif = trpc.settings.get.useQuery({ key: 'desktopNotifications' })
  const setDesktopNotif = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'desktopNotifications' })
  })
  const notifEnabled = desktopNotif.data !== false

  // Confidence-marker guidance (app_settings KV, default on); hosts read it
  // at boot, so changes apply to newly started agent sessions.
  const confidenceSetting = trpc.settings.get.useQuery({ key: 'confidenceRatings' })
  const setConfidence = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'confidenceRatings' })
  })
  const confidenceEnabled = confidenceSetting.data !== false

  // Self-verification steering (app_settings KV, opt-in default off); hosts
  // read it at boot and each chat's ⋯ menu can override it per chat.
  const verifySetting = trpc.settings.get.useQuery({ key: 'verifyWork' })
  const setVerify = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'verifyWork' })
  })
  const verifyEnabled = verifySetting.data === true

  // Tasks auto-continue (app_settings KV, opt-in default off); the session
  // manager reads it at each run end and each chat's ⋯ menu can override it.
  const autoContinueSetting = trpc.settings.get.useQuery({ key: 'autoContinueTasks' })
  const setAutoContinue = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'autoContinueTasks' })
  })
  const autoContinueEnabled = autoContinueSetting.data === true

  // Suggested-knowledge guidance (app_settings KV, default on); hosts read it
  // at boot, so changes apply to newly started agent sessions.
  const suggestKnowledgeSetting = trpc.settings.get.useQuery({ key: 'suggestKnowledge' })
  const setSuggestKnowledge = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'suggestKnowledge' })
  })
  const suggestKnowledgeEnabled = suggestKnowledgeSetting.data !== false

  // Follow-up-suggestion guidance (app_settings KV, default on); hosts read
  // it at boot, so changes apply to newly started agent sessions.
  const followUpsSetting = trpc.settings.get.useQuery({ key: 'followUpSuggestions' })
  const setFollowUps = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'followUpSuggestions' })
  })
  const followUpsEnabled = followUpsSetting.data !== false

  // Commit co-author identity (app_settings KV); applied to hosts at boot.
  const coAuthor = trpc.settings.get.useQuery({ key: 'commitCoAuthor' })
  const setCoAuthor = trpc.settings.set.useMutation({
    onSuccess: () => {
      markDirty()
      utils.settings.get.invalidate({ key: 'commitCoAuthor' })
    }
  })
  const ca = (coAuthor.data as { name?: string; email?: string } | null) ?? {}
  const saveCoAuthor = (field: 'name' | 'email', value: string): void => {
    const v = value.trim()
    if ((v || undefined) === (ca[field] || undefined)) return
    setCoAuthor.mutate({ key: 'commitCoAuthor', value: { ...ca, [field]: v || undefined } })
  }

  const p = settings.data?.preferences ?? {}
  const error =
    settings.error ??
    setPreferences.error ??
    setSetting.error ??
    setTokenCompression.error ??
    setCrossAgent.error ??
    setScheduleTools.error ??
    setKnowledgeEnabled.error ??
    setExperimentalAgent.error ??
    setDesktopNotif.error ??
    setConfidence.error ??
    setVerify.error ??
    setSuggestKnowledge.error ??
    setFollowUps.error ??
    setCoAuthor.error

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

      <div className="flex items-center gap-2">
        <span className="w-28 text-[11px] text-muted-foreground">Web search</span>
        <Tip content="Provider for the agent's web_search tool — auto picks the first configured key (Tavily, then Parallel); an explicit choice is honored only while its key is set. Keys go in API Keys → Environment variables (TAVILY_API_KEY / PARALLEL_API_KEY)">
          <select
            value={p.webSearchProvider ?? 'auto'}
            onChange={(e) =>
              setPreferences.mutate({
                webSearchProvider: e.target.value as (typeof WEB_SEARCH_PROVIDERS)[number]
              })
            }
            className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
          >
            {WEB_SEARCH_PROVIDERS.map((t) => (
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
          <div className="text-xs font-medium">Notifications</div>
          <div className="text-[11px] text-muted-foreground">
            System notification when a run finishes or the agent needs approval or input while the
            app is in the background. Clicking one opens the chat.
          </div>
        </div>
        <Tip content="Show a desktop notification for agent activity while the app is unfocused">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={notifEnabled}
              onCheckedChange={(v) =>
                setDesktopNotif.mutate({ key: 'desktopNotifications', value: v })
              }
            />
            Desktop notifications
          </label>
        </Tip>
      </div>

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Confidence ratings</div>
          <div className="text-[11px] text-muted-foreground">
            Asks the agent to rate how confident it is in a new task (green / yellow / red, shown as
            a chip in the chat header and on plan cards) and to ask clarifying questions first when
            it isn&apos;t green. Applies to newly started agent sessions.
          </div>
        </div>
        <Tip content="Inject the confidence-marker guidance into new agent sessions — when off, the agent is never asked to rate its confidence and no chip appears">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={confidenceEnabled}
              disabled={setConfidence.isPending}
              onCheckedChange={(v) => setConfidence.mutate({ key: 'confidenceRatings', value: v })}
            />
            Agent confidence ratings
          </label>
        </Tip>
      </div>

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Verify work before finishing</div>
          <div className="text-[11px] text-muted-foreground">
            Asks the agent to discover and run the project&apos;s own checks (typecheck, lint,
            tests, build) before claiming a task is done, fix failures, and report honestly if
            something still fails. Applies to newly started agent sessions; each chat&apos;s ⋯ menu
            can override it.
          </div>
        </div>
        <Tip content="Inject the self-verification guidance into new agent sessions — runs take longer but finish verified; a per-chat Default/On/Off override lives in the chat's ⋯ menu">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={verifyEnabled}
              disabled={setVerify.isPending}
              onCheckedChange={(v) => setVerify.mutate({ key: 'verifyWork', value: v })}
            />
            Verify work before finishing
          </label>
        </Tip>
      </div>

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Auto-continue unfinished tasks</div>
          <div className="text-[11px] text-muted-foreground">
            When a run ends normally but the agent&apos;s task list still has unfinished items,
            Yardarm automatically sends a hidden &quot;continue&quot; so long task lists keep moving
            without you re-prompting. Never fires after you press Stop, on errors, or while the
            agent is waiting on you; stops after 25 rounds per prompt or when a round makes no task
            progress. Each chat&apos;s ⋯ menu can override it.
          </div>
        </div>
        <Tip content="Resume runs automatically while the task list has unfinished items — stops after 25 rounds or when no progress is made; a per-chat Default/On/Off override lives in the chat's ⋯ menu">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={autoContinueEnabled}
              disabled={setAutoContinue.isPending}
              onCheckedChange={(v) =>
                setAutoContinue.mutate({ key: 'autoContinueTasks', value: v })
              }
            />
            Auto-continue unfinished tasks
          </label>
        </Tip>
      </div>

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Suggest knowledge notes</div>
          <div className="text-[11px] text-muted-foreground">
            Asks the agent to end a reply with one durable project fact it learned, shown as a
            save/dismiss card under the message. Saved notes live in Project settings → Knowledge.
            Applies to newly started agent sessions.
          </div>
        </div>
        <Tip content="Inject the suggested-knowledge guidance into new agent sessions — when off, the agent never proposes notes and no card appears">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={suggestKnowledgeEnabled}
              disabled={setSuggestKnowledge.isPending}
              onCheckedChange={(v) =>
                setSuggestKnowledge.mutate({ key: 'suggestKnowledge', value: v })
              }
            />
            Suggest knowledge notes
          </label>
        </Tip>
      </div>

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Follow-up suggestions</div>
          <div className="text-[11px] text-muted-foreground">
            Asks the agent to end substantial replies with up to three short next-step suggestions,
            shown as clickable chips that prefill the composer — nothing is sent until you press
            send. Applies to newly started agent sessions.
          </div>
        </div>
        <Tip content="Inject the follow-up guidance into new agent sessions — when off, the agent never proposes next steps and no chips appear">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={followUpsEnabled}
              disabled={setFollowUps.isPending}
              onCheckedChange={(v) => setFollowUps.mutate({ key: 'followUpSuggestions', value: v })}
            />
            Follow-up suggestions
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

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Commit attribution</div>
          <div className="text-[11px] text-muted-foreground">
            Agent-made commits include a <code>Co-Authored-By</code> trailer (built into
            mastracode&apos;s commit guidance). Set a custom identity here; blank fields use the
            mastracode default. Restart running agents to apply.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-28 text-[11px] text-muted-foreground">Co-author name</span>
          <Tip content="Name used in the Co-Authored-By trailer of agent-made commits — blank uses mastracode's default identity">
            <Input
              key={`name-${ca.name ?? ''}`}
              className="h-7 w-64 text-[11px]"
              defaultValue={ca.name ?? ''}
              placeholder="mastra-platform[bot] (default)"
              onBlur={(e) => saveCoAuthor('name', e.target.value)}
            />
          </Tip>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-28 text-[11px] text-muted-foreground">Co-author email</span>
          <Tip content="Email used in the Co-Authored-By trailer of agent-made commits — blank uses the mastra-platform bot noreply address">
            <Input
              key={`email-${ca.email ?? ''}`}
              className="h-7 w-64 text-[11px]"
              defaultValue={ca.email ?? ''}
              placeholder="bot noreply address (default)"
              onBlur={(e) => saveCoAuthor('email', e.target.value)}
            />
          </Tip>
        </div>
      </div>

      <div className="space-y-3 rounded border border-border p-3">
        <div>
          <div className="text-xs font-medium">Experimental</div>
          <div className="text-[11px] text-muted-foreground">
            Early mastracode features that may change or break. Shared with the CLI via
            settings.json.
          </div>
        </div>
        <Tip content="Gives agents tools to discover other running mastracode agents on this machine and send signals to them (agent_connect, agent_signal_send). Restart running agents to apply">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={settings.data?.signals?.experimentalCrossAgentSignals === true}
              disabled={setCrossAgent.isPending}
              onCheckedChange={(v) => setCrossAgent.mutate({ enabled: v })}
            />
            Cross-agent communication (peer discovery + signal tools)
          </label>
        </Tip>
        <Tip content="Gives agents tools to manage recurring prompt schedules on their own thread (schedule_create/list/update/resume/run). Schedules live inside the agent process and end with it. Restart running agents to apply">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={settings.data?.signals?.experimentalScheduleTools === true}
              disabled={setScheduleTools.isPending}
              onCheckedChange={(v) => setScheduleTools.mutate({ enabled: v })}
            />
            Schedule tools (recurring prompts on the agent&apos;s thread)
          </label>
        </Tip>
        <Tip content="Gives agents a persistent knowledge base scoped to the project and machine (knowledge read/write/list tools + the /knowledge browser). Restart running agents to apply">
          <label className="flex w-fit items-center gap-2 text-xs">
            <Switch
              checked={settings.data?.signals?.experimentalKnowledge === true}
              disabled={setKnowledgeEnabled.isPending}
              onCheckedChange={(v) => setKnowledgeEnabled.mutate({ enabled: v })}
            />
            Knowledge (persistent agent knowledge base + /knowledge browser)
          </label>
        </Tip>
        <div className="flex items-center gap-2">
          <span className="w-28 text-[11px] text-muted-foreground">Agent runtime</span>
          <Tip content="Experimental agent execution runtime (settings.json experimentalAgent). Applies to new or restarted agents; invalid setups fail at agent start — switch back to default if agents stop booting">
            <select
              value={experimentalAgent}
              disabled={setExperimentalAgent.isPending}
              onChange={(e) => {
                const v = e.target.value
                setExperimentalAgent.mutate({
                  value: v === 'durable' || v === 'evented' ? v : null
                })
              }}
              className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
            >
              <option value="off">default</option>
              <option value="durable">durable</option>
              <option value="evented">evented</option>
            </select>
          </Tip>
        </div>
      </div>

      <ToolsSection />

      <StorageSection />

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}
      {banner}
    </div>
  )
}
