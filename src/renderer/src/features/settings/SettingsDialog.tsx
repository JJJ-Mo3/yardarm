import React, { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import {
  Boxes,
  Globe,
  Info,
  KeyRound,
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
import { Textarea } from '../../components/ui/textarea'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { AboutTab } from './AboutTab'
import { BrowserTab } from './BrowserTab'
import { ModelsTab } from './ModelsTab'
import { PreferencesTab } from './PreferencesTab'
import { ProvidersTab } from './ProvidersTab'
import { VoiceTab } from './VoiceTab'

const PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter', 'xai', 'groq', 'mistral']

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

  /** Credentials changed: hasApiKey flags and available packs are stale. */
  const invalidateModelData = (): void => {
    utils.agent.listModels.invalidate()
    utils.mastraSettings.listPacks.invalidate()
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

function McpTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const servers = trpc.mcp.get.useQuery({})
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (servers.data && !dirty) {
      setText(JSON.stringify(servers.data, null, 2))
    }
  }, [servers.data, dirty])

  const save = trpc.mcp.set.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.mcp.get.invalidate()
    }
  })

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        Edits <code>~/.mastracode/mcp.json</code> (shared with the CLI). Agent processes restart on
        save.
      </div>
      <Textarea
        rows={14}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
          setError(null)
        }}
        className="font-mono text-[11px]"
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <Tip content="Write mcp.json and restart agent processes so the new servers load">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => {
                try {
                  const parsed = JSON.parse(text) as Record<string, Record<string, unknown>>
                  save.mutate({ servers: parsed })
                } catch {
                  setError('Invalid JSON')
                }
              }}
            >
              Save & restart agents
            </Button>
          </span>
        </Tip>
        {error && <span className="text-xs text-destructive">{error}</span>}
        {save.error && (
          <span className="text-xs text-destructive selectable">{save.error.message}</span>
        )}
      </div>
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
      id: 'mcp',
      label: 'MCP Servers',
      icon: <Server size={13} />,
      tip: 'External tool servers (Model Context Protocol) available to agents'
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
          <div className="min-h-72 flex-1">
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'preferences' && <PreferencesTab />}
            {tab === 'keys' && <KeysTab />}
            {tab === 'models' && <ModelsTab />}
            {tab === 'providers' && <ProvidersTab />}
            {tab === 'voice' && <VoiceTab />}
            {tab === 'browser' && <BrowserTab />}
            {tab === 'mcp' && <McpTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
