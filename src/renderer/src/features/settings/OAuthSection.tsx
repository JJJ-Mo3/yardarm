/**
 * OAuth login/logout for SDK providers (Anthropic, OpenAI Codex, GitHub
 * Copilot). Runs the interactive flow: opens the browser, shows progress,
 * and collects a manual code when the provider asks for one.
 */
import React, { useRef, useState } from 'react'
import { ExternalLink, LogIn, LogOut } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'

interface ActiveFlow {
  flowId: string
  provider: string
  providerName: string
}

export function OAuthSection(): React.JSX.Element {
  const utils = trpc.useUtils()
  const providers = trpc.settings.oauthProviders.useQuery()

  const [flow, setFlow] = useState<ActiveFlow | null>(null)
  const flowRef = useRef<ActiveFlow | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<{ message: string; placeholder?: string } | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [modeByProvider, setModeByProvider] = useState<Record<string, string>>({})

  function resetFlow(): void {
    flowRef.current = null
    setFlow(null)
    setStatusMsg('')
    setAuthUrl(null)
    setPrompt(null)
    setPromptValue('')
  }

  trpc.settings.onOauthStatus.useSubscription(undefined, {
    onData: (ev) => {
      const active = flowRef.current
      if (!active || ev.flowId !== active.flowId) return
      switch (ev.kind) {
        case 'auth-url':
          setAuthUrl(ev.url ?? null)
          setStatusMsg(ev.instructions ?? 'Complete the login in your browser…')
          break
        case 'progress':
          setStatusMsg(ev.message ?? '')
          break
        case 'prompt':
          setPrompt({ message: ev.message ?? 'Enter the code', placeholder: ev.placeholder })
          break
        case 'done':
          resetFlow()
          utils.settings.oauthProviders.invalidate()
          utils.settings.authList.invalidate()
          utils.agent.listModels.invalidate()
          utils.mastraSettings.listPacks.invalidate()
          break
        case 'error':
          setError(ev.message ?? 'Login failed')
          resetFlow()
          break
      }
    }
  })

  const start = trpc.settings.oauthStart.useMutation()
  const respond = trpc.settings.oauthPrompt.useMutation()
  const cancel = trpc.settings.oauthCancel.useMutation()
  const logout = trpc.settings.oauthLogout.useMutation({
    onSuccess: () => {
      utils.settings.oauthProviders.invalidate()
      utils.settings.authList.invalidate()
      utils.agent.listModels.invalidate()
      utils.mastraSettings.listPacks.invalidate()
    }
  })

  async function login(provider: string, providerName: string): Promise<void> {
    setError(null)
    const res = await start.mutateAsync({
      provider,
      authMode: modeByProvider[provider] || undefined
    })
    const active = { flowId: res.flowId, provider, providerName }
    flowRef.current = active
    setFlow(active)
    setStatusMsg('Starting login…')
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">OAuth logins</div>
      <div className="text-[11px] text-muted-foreground">
        Log in with a provider subscription instead of an API key (/login, /logout).
      </div>
      {providers.error && (
        <div className="text-xs text-destructive selectable">{providers.error.message}</div>
      )}
      <div className="space-y-1">
        {(providers.data ?? []).map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 rounded border border-border px-2 py-1.5"
          >
            <span className="flex-1 text-xs font-medium">{p.name}</span>
            {(p.authModes?.length ?? 0) > 1 && !p.loggedIn && (
              <Tip content="Which kind of account to log in with (e.g. subscription vs API billing)">
              <select
                value={modeByProvider[p.id] ?? p.authModes![0].id}
                onChange={(e) =>
                  setModeByProvider((m) => ({ ...m, [p.id]: e.target.value }))
                }
                className="h-6 rounded border border-border bg-background px-1 text-[11px]"
              >
                {p.authModes!.map((m) => (
                  <option key={m.id} value={m.id} title={m.description}>
                    {m.name}
                  </option>
                ))}
              </select>
              </Tip>
            )}
            {p.loggedIn ? (
              <>
                <span className="text-[11px] text-green-500">Logged in</span>
                <Tip content="Sign out and remove the stored credentials for this provider">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={logout.isPending}
                      onClick={() => logout.mutate({ provider: p.id })}
                    >
                      <LogOut size={12} />
                      Log out
                    </Button>
                  </span>
                </Tip>
              </>
            ) : (
              <Tip content="Start the browser login flow for this provider">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={flow !== null || start.isPending}
                    onClick={() => login(p.id, p.name)}
                  >
                    <LogIn size={12} />
                    Log in
                  </Button>
                </span>
              </Tip>
            )}
          </div>
        ))}
        {providers.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      </div>

      {flow && (
        <div className="space-y-2 rounded border border-border bg-accent/30 p-2">
          <div className="text-xs font-medium">Logging in to {flow.providerName}…</div>
          {statusMsg && <div className="text-[11px] text-muted-foreground">{statusMsg}</div>}
          {authUrl && (
            <a
              href={authUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
            >
              <ExternalLink size={11} />
              Open the login page again
            </a>
          )}
          {prompt && (
            <div className="space-y-1">
              <div className="text-[11px]">{prompt.message}</div>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder={prompt.placeholder ?? 'Paste code'}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && promptValue.trim()) {
                      respond.mutate({ flowId: flow.flowId, value: promptValue.trim() })
                      setPrompt(null)
                      setPromptValue('')
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={!promptValue.trim()}
                  onClick={() => {
                    respond.mutate({ flowId: flow.flowId, value: promptValue.trim() })
                    setPrompt(null)
                    setPromptValue('')
                  }}
                >
                  Submit
                </Button>
              </div>
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              cancel.mutate({ flowId: flow.flowId })
              resetFlow()
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {error && <div className="text-xs text-destructive selectable">{error}</div>}
    </div>
  )
}
