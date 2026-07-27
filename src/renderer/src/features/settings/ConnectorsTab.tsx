/**
 * Settings → Connectors: one-click integrations with common dev platforms
 * (GitHub, GitLab, Supabase, Netlify, Vercel, Sentry) via their official MCP
 * servers, written into the global ~/.mastracode/mcp.json. Connecting is
 * verified end-to-end in the main process (server load → OAuth or token →
 * tools listed) against the shared utility host, so no chat is required and
 * closing this dialog doesn't interrupt an in-flight sign-in.
 */
import React, { useEffect, useState } from 'react'
import { useSetAtom } from 'jotai'
import { Bug, Database, ExternalLink, GitBranch, GitMerge, Rocket, Triangle } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { settingsTabAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import type { McpServerStatusInfo } from '@shared/ipc-types'
import {
  CONNECTORS,
  connectorState,
  gitlabMcpUrl,
  type ConnectorDef,
  type ConnectorServerConfig,
  type ConnectorState
} from './connector-catalog'

// lucide dropped brand glyphs — use thematically close generic icons instead.
const CONNECTOR_ICONS: Record<string, React.ReactNode> = {
  github: <GitBranch size={16} />,
  gitlab: <GitMerge size={16} />,
  supabase: <Database size={16} />,
  netlify: <Rocket size={16} />,
  vercel: <Triangle size={16} />,
  sentry: <Bug size={16} />
}

/** In-flight connect verification phase for one server (renderer-side view). */
type ConnectPhase = 'connecting' | 'auth'

function StatusLine({ info }: { info: McpServerStatusInfo }): React.JSX.Element {
  // The SDK resolves authentication with a status instead of rejecting;
  // a user-cancelled flow carries cancelled so its error isn't alarming.
  if (info.connecting) return <span className="text-muted-foreground">Connecting…</span>
  if (info.connected) {
    const label = (
      <span className="text-green-600 dark:text-green-500">
        Connected · {info.toolCount} tool{info.toolCount === 1 ? '' : 's'}
      </span>
    )
    if (info.toolNames.length === 0) return label
    return <Tip content={`Tools: ${info.toolNames.join(', ')}`}>{label}</Tip>
  }
  if (info.authenticating)
    return <span className="text-amber-600 dark:text-amber-500">Authenticating…</span>
  if (info.needsAuth)
    return <span className="text-amber-600 dark:text-amber-500">Needs authentication</span>
  if (info.cancelled) return <span className="text-muted-foreground">Authentication cancelled</span>
  if (info.error)
    return (
      <span className="text-destructive" title={info.error}>
        {info.error.length > 80 ? `${info.error.slice(0, 80)}…` : info.error}
      </span>
    )
  return <span className="text-muted-foreground">Not connected</span>
}

interface CardProps {
  def: ConnectorDef
  state: ConnectorState
  info: McpServerStatusInfo | undefined
  phase: ConnectPhase | undefined
  authUrl: string | undefined
  error: string | undefined
  disconnectPending: boolean
  authPending: boolean
  onConnect: (config: ConnectorServerConfig, autoAuth: boolean) => void
  onDisconnect: () => void
  onAuthenticate: () => void
  onCancelAuth: () => void
  onReconnect: () => void
  onOpenDocs: () => void
  onManageCustom: () => void
}

function ConnectorCard(props: CardProps): React.JSX.Element {
  const { def, state, info, phase } = props
  const [instanceUrl, setInstanceUrl] = useState('https://gitlab.com')
  const [showToken, setShowToken] = useState(false)
  const [token, setToken] = useState('')

  // Drop any half-typed credentials once the connector leaves the setup state.
  useEffect(() => {
    if (state !== 'none') {
      setToken('')
      setShowToken(false)
    }
  }, [state])

  const instanceEndpoint = def.needsInstanceUrl ? gitlabMcpUrl(instanceUrl) : null
  const instanceInvalid = def.needsInstanceUrl && instanceEndpoint === null
  const connectPending = Boolean(phase)
  // Platforms without OAuth dynamic client registration can't do browser
  // sign-in at all — the token form is the primary (and only) connect path.
  const tokenOnly = Boolean(def.tokenOnly && def.tokenAlt)
  // Actionable guidance for known error phrasings, whether the error came
  // from a connect attempt (card error) or the polled server status.
  const rawError =
    props.error ??
    (state === 'managed' && info && !info.connected && !info.connecting ? info.error : undefined)
  const errorHint = rawError ? (def.errorHint?.(rawError) ?? null) : null

  return (
    <div className="rounded border border-border px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground">{CONNECTOR_ICONS[def.id]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{def.title}</span>
            <Tip
              content={`Open the official ${def.title} MCP server documentation in your browser`}
            >
              <button
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={props.onOpenDocs}
              >
                <ExternalLink size={11} />
              </button>
            </Tip>
          </div>
          <div className="text-[11px] text-muted-foreground">{def.description}</div>

          {/* Status line */}
          <div className="mt-1 text-[10px]">
            {phase === 'connecting' && (
              <span className="text-muted-foreground">Connecting and verifying…</span>
            )}
            {phase === 'auth' && (
              <span className="text-amber-600 dark:text-amber-500">
                Waiting for sign-in in your browser…
              </span>
            )}
            {!phase && state === 'none' && (
              <span className="text-muted-foreground">Not connected</span>
            )}
            {!phase && state === 'custom' && (
              <span className="text-muted-foreground">
                Configured with a custom setup — manage it in the MCP Servers tab.
              </span>
            )}
            {!phase &&
              state === 'managed' &&
              (info ? (
                <StatusLine info={info} />
              ) : (
                <span className="text-muted-foreground">
                  Configured — waiting for the agent to load it…
                </span>
              ))}
          </div>

          {/* Auth fallback link */}
          {(phase === 'auth' || (state === 'managed' && info?.authenticating)) && props.authUrl && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              Browser didn&apos;t open?{' '}
              <a
                href={props.authUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                Open the authorization page
              </a>
            </div>
          )}

          {/* GitLab instance URL */}
          {state === 'none' && def.needsInstanceUrl && (
            <div className="mt-2 space-y-1">
              <Input
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
                placeholder="https://gitlab.com"
                className="h-7 text-[11px]"
                spellCheck={false}
              />
              {instanceInvalid && (
                <div className="text-[10px] text-destructive">
                  Enter a valid http(s) GitLab instance URL.
                </div>
              )}
            </div>
          )}

          {/* Token form — the only connect path for tokenOnly platforms, an
              optional alternative to OAuth elsewhere. */}
          {state === 'none' && def.tokenAlt && (
            <div className="mt-2">
              {!tokenOnly && (
                <Tip content={showToken ? 'Hide the access-token form' : def.tokenAlt.hint}>
                  <button
                    className="text-[10px] text-muted-foreground underline hover:text-foreground cursor-pointer"
                    onClick={() => setShowToken((v) => !v)}
                  >
                    {def.tokenAlt.label}
                  </button>
                </Tip>
              )}
              {(tokenOnly || showToken) && (
                <div className={tokenOnly ? 'space-y-1' : 'mt-1.5 space-y-1'}>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Access token"
                      className="h-7 text-[11px]"
                      spellCheck={false}
                    />
                    {!tokenOnly && (
                      <Tip
                        content={`Save the token and verify the ${def.title} connection without OAuth`}
                      >
                        <span className="inline-flex">
                          <Button
                            size="sm"
                            className="h-7 px-2 text-[10px]"
                            disabled={!token.trim() || connectPending}
                            onClick={() =>
                              props.onConnect(def.tokenAlt!.build(token.trim()), false)
                            }
                          >
                            {connectPending ? 'Verifying…' : 'Save'}
                          </Button>
                        </span>
                      </Tip>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{def.tokenAlt.hint}</div>
                </div>
              )}
            </div>
          )}

          {/* Token platforms can't OAuth — a broken connection means the
              stored token is missing, invalid, or expired. */}
          {tokenOnly && state === 'managed' && info && !info.connected && !info.connecting && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              {def.title} connects with a personal access token — if this keeps failing, disconnect
              and connect again with a fresh token.
            </div>
          )}

          {props.error && (
            <div className="mt-1 text-[10px] text-destructive selectable">{props.error}</div>
          )}

          {errorHint && (
            <div className="mt-1 text-[10px] text-muted-foreground selectable">{errorHint}</div>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {state === 'none' && phase !== 'auth' && (
            <Tip
              content={
                tokenOnly
                  ? `Save the token and verify the ${def.title} connection`
                  : `Add the official ${def.title} MCP server, sign in in your browser, and verify the connection`
              }
            >
              <span className="inline-flex">
                <Button
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={connectPending || instanceInvalid || (tokenOnly && !token.trim())}
                  onClick={() =>
                    props.onConnect(
                      tokenOnly
                        ? def.tokenAlt!.build(token.trim())
                        : def.needsInstanceUrl
                          ? def.build({ instanceUrl })
                          : def.build({}),
                      !tokenOnly
                    )
                  }
                >
                  {connectPending ? 'Connecting…' : 'Connect'}
                </Button>
              </span>
            </Tip>
          )}
          {state === 'none' && phase === 'auth' && (
            <Tip content="Cancel the pending sign-in — you can connect again afterwards">
              <span className="inline-flex">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={props.onCancelAuth}
                >
                  Cancel
                </Button>
              </span>
            </Tip>
          )}
          {state === 'custom' && (
            <Tip content="This server name is configured manually — open the MCP Servers tab to edit or remove it">
              <button
                className="text-[10px] text-muted-foreground underline hover:text-foreground cursor-pointer"
                onClick={props.onManageCustom}
              >
                Manage
              </button>
            </Tip>
          )}
          {state === 'managed' && (
            <>
              {info?.needsAuth && !info.authenticating && !tokenOnly && (
                <Tip content="Run the OAuth flow for this server in your browser">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={props.authPending}
                      onClick={props.onAuthenticate}
                    >
                      Authenticate
                    </Button>
                  </span>
                </Tip>
              )}
              {info?.authenticating && (
                <Tip content="Cancel the pending authentication — it can be retried afterwards">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={props.authPending}
                      onClick={props.onCancelAuth}
                    >
                      Cancel
                    </Button>
                  </span>
                </Tip>
              )}
              {info &&
                !info.connected &&
                (!info.needsAuth || tokenOnly) &&
                !info.authenticating &&
                !info.connecting && (
                  <Tip content="Retry the connection to this server">
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        disabled={props.authPending}
                        onClick={props.onReconnect}
                      >
                        Reconnect
                      </Button>
                    </span>
                  </Tip>
                )}
              <Tip
                content={
                  connectPending || info?.authenticating
                    ? 'Wait for the pending connection or cancel it before disconnecting'
                    : `Remove the ${def.title} server from mcp.json — agents restart and lose its tools`
                }
              >
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    disabled={
                      props.disconnectPending || connectPending || Boolean(info?.authenticating)
                    }
                    onClick={props.onDisconnect}
                  >
                    Disconnect
                  </Button>
                </span>
              </Tip>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function ConnectorsTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const setTab = useSetAtom(settingsTabAtom)
  const servers = trpc.mcp.get.useQuery({})
  const serverMap = servers.data ?? {}
  const anyManaged = CONNECTORS.some((def) => connectorState(def, serverMap) === 'managed')
  // Live status from the shared utility host — works with no chat open. Only
  // polled once a connector is configured, so an empty tab boots no host.
  const status = trpc.mcp.status.useQuery(
    { subchatId: null },
    { enabled: anyManaged, refetchInterval: 5000 }
  )
  // Fallback links for in-flight OAuth flows (main already opened the browser).
  const [authUrls, setAuthUrls] = useState<Record<string, string>>({})
  // Per-server in-flight connect verification phase.
  const [connectPhases, setConnectPhases] = useState<Record<string, ConnectPhase>>({})
  const setPhase = (name: string, phase: ConnectPhase | null): void => {
    setConnectPhases((prev) => {
      const next = { ...prev }
      if (phase === null) delete next[name]
      else next[name] = phase
      return next
    })
  }
  trpc.mcp.onAuthUrl.useSubscription(undefined, {
    onData: (ev) => {
      setAuthUrls((prev) => ({ ...prev, [ev.serverName]: ev.url }))
      // The consent URL means the connect flow reached its OAuth step.
      setConnectPhases((prev) =>
        prev[ev.serverName] === 'connecting' ? { ...prev, [ev.serverName]: 'auth' } : prev
      )
    }
  })
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  const setCardError = (name: string, message: string | null): void => {
    setCardErrors((prev) => {
      const next = { ...prev }
      if (message === null) delete next[name]
      else next[name] = message
      return next
    })
  }

  const invalidateStatus = (): void => {
    utils.mcp.status.invalidate()
  }
  const connectServer = trpc.mcp.connect.useMutation()
  const removeServer = trpc.mcp.removeServer.useMutation({
    onSettled: () => {
      utils.mcp.get.invalidate()
      invalidateStatus()
    }
  })
  const authenticate = trpc.mcp.authenticate.useMutation({ onSettled: invalidateStatus })
  const cancelAuth = trpc.mcp.cancelAuth.useMutation({ onSettled: invalidateStatus })
  const reconnect = trpc.mcp.reconnect.useMutation({ onSettled: invalidateStatus })
  const openExternal = trpc.system.openExternal.useMutation()

  const connect = (def: ConnectorDef, config: ConnectorServerConfig, autoAuth: boolean): void => {
    setCardError(def.serverName, null)
    setPhase(def.serverName, 'connecting')
    connectServer.mutate(
      { name: def.serverName, config, autoAuth },
      {
        onSuccess: (info) => {
          // The mutation resolves with the verified final status; anything
          // short of connected is surfaced as a card error with retry.
          if (!info.connected) {
            setCardError(
              def.serverName,
              info.cancelled
                ? 'Authentication cancelled.'
                : info.needsAuth
                  ? (info.error ?? 'The server still requires authentication — check the token.')
                  : (info.error ?? 'The server did not connect.')
            )
          }
        },
        onError: (e) => setCardError(def.serverName, e.message),
        onSettled: () => {
          setPhase(def.serverName, null)
          utils.mcp.get.invalidate()
          invalidateStatus()
        }
      }
    )
  }
  const disconnect = (def: ConnectorDef): void => {
    setCardError(def.serverName, null)
    removeServer.mutate(
      { name: def.serverName },
      { onError: (e) => setCardError(def.serverName, e.message) }
    )
  }
  const runAuthAction = (
    def: ConnectorDef,
    mutation: typeof authenticate | typeof cancelAuth | typeof reconnect
  ): void => {
    setCardError(def.serverName, null)
    mutation.mutate(
      { subchatId: null, serverName: def.serverName },
      { onError: (e) => setCardError(def.serverName, e.message) }
    )
  }

  const statusByName = new Map((status.data ?? []).map((s) => [s.name, s]))
  const authPending = authenticate.isPending || cancelAuth.isPending || reconnect.isPending

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        One-click connections via each platform&apos;s official MCP server. Connecting verifies the
        server end-to-end — sign-in included — and entries are written to{' '}
        <code>~/.mastracode/mcp.json</code> (shared with the CLI); agents restart on changes.
      </div>
      {servers.error && (
        <div className="text-xs text-destructive selectable">{servers.error.message}</div>
      )}
      {status.error && (
        <div className="text-xs text-destructive selectable">{status.error.message}</div>
      )}
      {CONNECTORS.map((def) => (
        <ConnectorCard
          key={def.id}
          def={def}
          state={connectorState(def, serverMap)}
          info={statusByName.get(def.serverName)}
          phase={connectPhases[def.serverName]}
          authUrl={authUrls[def.serverName]}
          error={cardErrors[def.serverName]}
          disconnectPending={removeServer.isPending}
          authPending={authPending}
          onConnect={(config, autoAuth) => connect(def, config, autoAuth)}
          onDisconnect={() => disconnect(def)}
          onAuthenticate={() => runAuthAction(def, authenticate)}
          onCancelAuth={() => runAuthAction(def, cancelAuth)}
          onReconnect={() => runAuthAction(def, reconnect)}
          onOpenDocs={() => openExternal.mutate({ url: def.docsUrl })}
          onManageCustom={() => setTab('mcp')}
        />
      ))}
    </div>
  )
}
