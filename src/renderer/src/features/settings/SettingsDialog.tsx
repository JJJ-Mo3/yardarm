import React, { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { Boxes, Info, KeyRound, Palette, Plug, Server, Trash2 } from 'lucide-react'
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
import { AboutTab } from './AboutTab'
import { ModelsTab } from './ModelsTab'
import { OAuthSection } from './OAuthSection'
import { ProvidersTab } from './ProvidersTab'

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
            <Button
              key={t}
              size="sm"
              variant={theme === t ? 'default' : 'outline'}
              className="capitalize"
              onClick={() => setTheme(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={debug} onCheckedChange={setDebug} />
        Show raw agent event debug pane
      </label>
    </div>
  )
}

function KeysTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const auth = trpc.settings.authList.useQuery()
  const [provider, setProvider] = useState(PROVIDERS[0])
  const [apiKey, setApiKey] = useState('')

  const setKey = trpc.settings.authSet.useMutation({
    onSuccess: () => {
      setApiKey('')
      utils.settings.authList.invalidate()
    }
  })
  const removeKey = trpc.settings.authRemove.useMutation({
    onSuccess: () => utils.settings.authList.invalidate()
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
            <button
              title="Remove key"
              className="text-muted-foreground hover:text-destructive cursor-pointer"
              onClick={() => removeKey.mutate({ provider: entry.provider })}
            >
              <Trash2 size={12} />
            </button>
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
        <Button
          size="sm"
          disabled={!apiKey.trim() || setKey.isPending}
          onClick={() => setKey.mutate({ provider, apiKey: apiKey.trim() })}
        >
          Save
        </Button>
      </div>
      {setKey.error && (
        <div className="text-xs text-destructive selectable">{setKey.error.message}</div>
      )}
      <div className="border-t border-border pt-3">
        <OAuthSection />
      </div>
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

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: 'appearance', label: 'Appearance', icon: <Palette size={13} /> },
    { id: 'keys', label: 'API Keys', icon: <KeyRound size={13} /> },
    { id: 'models', label: 'Models', icon: <Boxes size={13} /> },
    { id: 'providers', label: 'Providers', icon: <Plug size={13} /> },
    { id: 'mcp', label: 'MCP Servers', icon: <Server size={13} /> },
    { id: 'about', label: 'About', icon: <Info size={13} /> }
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Settings</DialogTitle>
        <div className="flex gap-4">
          <div className="w-36 shrink-0 space-y-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs cursor-pointer',
                  tab === t.id ? 'bg-accent font-medium' : 'hover:bg-accent/50'
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-72 flex-1">
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'keys' && <KeysTab />}
            {tab === 'models' && <ModelsTab />}
            {tab === 'providers' && <ProvidersTab />}
            {tab === 'mcp' && <McpTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
