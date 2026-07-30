import React, { useState } from 'react'
import { useAtom } from 'jotai'
import {
  Bot,
  Boxes,
  Cable,
  Globe,
  Info,
  KeyRound,
  Languages,
  Mic,
  Palette,
  Plug,
  Server,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import {
  settingsOpenAtom,
  settingsTabAtom,
  themeAtom,
  debugEventsAtom,
  type Theme,
  type SettingsTab
} from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { AboutTab } from './AboutTab'
import { AgentsTab } from './AgentsTab'
import { BrowserTab } from './BrowserTab'
import { ConnectorsTab } from './ConnectorsTab'
import { LanguagesTab } from './LanguagesTab'
import { McpTab } from './McpTab'
import { ModelsTab } from './ModelsTab'
import { PreferencesTab } from './PreferencesTab'
import { ProvidersTab } from './ProvidersTab'
import { VoiceTab } from './VoiceTab'

const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'xai',
  'groq',
  'mistral',
  'deepgram'
]

function AppearanceTab(): React.JSX.Element {
  const [theme, setTheme] = useAtom(themeAtom)
  const [debug, setDebug] = useAtom(debugEventsAtom)
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-medium">Theme</div>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as Theme[]).map((t) => (
            <Tip
              key={t}
              content={
                t === 'system'
                  ? 'Follow the macOS light/dark appearance automatically'
                  : `Always use the ${t} theme`
              }
            >
              <Button
                size="sm"
                variant={theme === t ? 'default' : 'outline'}
                className="capitalize"
                onClick={() => setTheme(t)}
              >
                {t}
              </Button>
            </Tip>
          ))}
        </div>
      </div>
      <Tip content="Show a developer pane in chats with the raw event stream from the agent process">
        <label className="flex w-fit items-center gap-2 text-xs">
          <Switch checked={debug} onCheckedChange={setDebug} />
          Show raw agent event debug pane
        </label>
      </Tip>
    </div>
  )
}

/** Also used by the first-run onboarding wizard's auth step. */
export function KeysTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const auth = trpc.settings.authList.useQuery()
  const [provider, setProvider] = useState(PROVIDERS[0])
  const [apiKey, setApiKey] = useState('')

  /** Credentials changed: hasApiKey/hasKey flags and available packs are stale. */
  const invalidateModelData = (): void => {
    utils.agent.listModels.invalidate()
    utils.mastraSettings.listPacks.invalidate()
    utils.mastraSettings.sttRegistry.invalidate()
  }

  const setKey = trpc.settings.authSet.useMutation({
    onSuccess: () => {
      setApiKey('')
      utils.settings.authList.invalidate()
      invalidateModelData()
    }
  })
  const removeKey = trpc.settings.authRemove.useMutation({
    onSuccess: () => {
      utils.settings.authList.invalidate()
      invalidateModelData()
    }
  })

  const stored = auth.data ?? []

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Keys are stored in mastracode&apos;s app-data <code>auth.json</code> and shared with the
        mastracode CLI.
      </div>
      <div className="space-y-1">
        {auth.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {auth.error && (
          <div className="text-xs text-destructive selectable">{auth.error.message}</div>
        )}
        {stored.map((entry) => (
          <div
            key={entry.provider}
            className="flex items-center gap-2 rounded border border-border px-2 py-1.5"
          >
            <span className="flex-1 text-xs font-medium capitalize">{entry.provider}</span>
            <span className="font-mono text-[11px] text-muted-foreground">••••••••</span>
            <Tip content="Delete this API key — models from this provider become unavailable">
              <button
                className="text-muted-foreground hover:text-destructive cursor-pointer"
                onClick={() => removeKey.mutate({ provider: entry.provider })}
              >
                <Trash2 size={12} />
              </button>
            </Tip>
          </div>
        ))}
        {!auth.isLoading && stored.length === 0 && (
          <div className="text-xs text-muted-foreground">No provider keys configured.</div>
        )}
      </div>
      <div className="flex gap-2">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <Input
          type="password"
          placeholder="API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <Tip content="Store this API key and unlock the provider's models">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!apiKey.trim() || setKey.isPending}
              onClick={() => setKey.mutate({ provider, apiKey: apiKey.trim() })}
            >
              Save
            </Button>
          </span>
        </Tip>
      </div>
      {setKey.error && (
        <div className="text-xs text-destructive selectable">{setKey.error.message}</div>
      )}
    </div>
  )
}

export function SettingsDialog(): React.JSX.Element {
  const [open, setOpen] = useAtom(settingsOpenAtom)
  const [tab, setTab] = useAtom(settingsTabAtom)

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode; tip: string }> = [
    {
      id: 'appearance',
      label: 'Appearance',
      icon: <Palette size={13} />,
      tip: 'Theme and debug pane'
    },
    {
      id: 'preferences',
      label: 'Preferences',
      icon: <SlidersHorizontal size={13} />,
      tip: 'Agent behavior — approvals, notifications, output limits'
    },
    {
      id: 'keys',
      label: 'API Keys',
      icon: <KeyRound size={13} />,
      tip: 'Provider API keys'
    },
    {
      id: 'models',
      label: 'Models',
      icon: <Boxes size={13} />,
      tip: 'Default models per mode, model packs, and thresholds'
    },
    {
      id: 'providers',
      label: 'Providers',
      icon: <Plug size={13} />,
      tip: 'OAuth logins and local model providers like Ollama and LM Studio'
    },
    { id: 'voice', label: 'Voice', icon: <Mic size={13} />, tip: 'Voice input settings' },
    {
      id: 'browser',
      label: 'Browser',
      icon: <Globe size={13} />,
      tip: 'Browser automation settings for web tools'
    },
    {
      id: 'connectors',
      label: 'Connectors',
      icon: <Cable size={13} />,
      tip: 'One-click connections to GitHub, GitLab, Supabase, Netlify, Vercel, and Sentry'
    },
    {
      id: 'mcp',
      label: 'MCP Servers',
      icon: <Server size={13} />,
      tip: 'External tool servers (Model Context Protocol) — global or per-project'
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: <Bot size={13} />,
      tip: 'Custom subagents the main agent can delegate tasks to — global or per-project'
    },
    {
      id: 'languages',
      label: 'Languages',
      icon: <Languages size={13} />,
      tip: 'Optional language-server downloads for IDE diagnostics'
    },
    {
      id: 'about',
      label: 'About',
      icon: <Info size={13} />,
      tip: 'Versions, runtime status, and diagnostics'
    }
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Settings</DialogTitle>
        <div className="flex gap-4">
          <div className="w-36 shrink-0 space-y-0.5">
            {tabs.map((t) => (
              <Tip key={t.id} content={t.tip} side="right">
                <button
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs cursor-pointer',
                    tab === t.id ? 'bg-accent font-medium' : 'hover:bg-accent/50'
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              </Tip>
            ))}
          </div>
          <div className="min-h-72 max-h-[65vh] min-w-0 flex-1 overflow-y-auto pr-1">
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'preferences' && <PreferencesTab />}
            {tab === 'keys' && <KeysTab />}
            {tab === 'models' && <ModelsTab />}
            {tab === 'providers' && <ProvidersTab />}
            {tab === 'voice' && <VoiceTab />}
            {tab === 'browser' && <BrowserTab />}
            {tab === 'connectors' && <ConnectorsTab />}
            {tab === 'mcp' && <McpTab />}
            {tab === 'agents' && <AgentsTab />}
            {tab === 'languages' && <LanguagesTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
