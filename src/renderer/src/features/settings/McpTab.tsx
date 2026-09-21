/**
 * MCP servers editor (Settings → MCP Servers). Edits ~/.mastracode/mcp.json
 * (global, the default scope) or a project's .mastracode/mcp.json (picked
 * from existing projects, merged over global) as raw JSON, plus live
 * per-server status with OAuth actions and persistent enable/disable — served
 * by the shared utility host for the global scope, or by the open chat's agent
 * for project scope. Global scope also exposes the opt-in Claude Code / Codex
 * server-discovery toggles (settings.json `mcp`).
 */
import React, { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { trpc } from '../../lib/trpc'
import { selectedProjectIdAtom, selectedSubchatIdAtom } from '../../lib/atoms'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'
import { useRestartBanner } from './restart-banner'

type Scope = 'global' | 'project'

/**
 * Live per-server MCP status with OAuth actions for servers that require
 * authentication. subchatId null queries the shared utility host (global
 * scope); live=false renders a hint instead (project scope without a chat).
 * Global scope edits each server's global default; project scope sets a
 * per-project override (enabled/disabled) or inherits the global default.
 */
function McpStatusSection({
  subchatId,
  live,
  scope
}: {
  subchatId: string | null
  live: boolean
  scope: Scope
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const status = trpc.mcp.status.useQuery({ subchatId }, { enabled: live, refetchInterval: 5000 })
  // Fallback links for in-flight OAuth flows (main already opened the browser).
  const [authUrls, setAuthUrls] = useState<Record<string, string>>({})
  trpc.mcp.onAuthUrl.useSubscription(undefined, {
    onData: (ev) => setAuthUrls((prev) => ({ ...prev, [ev.serverName]: ev.url }))
  })
  const invalidate = (): void => {
    utils.mcp.status.invalidate({ subchatId })
  }
  const authenticate = trpc.mcp.authenticate.useMutation({ onSettled: invalidate })
  const cancelAuth = trpc.mcp.cancelAuth.useMutation({ onSettled: invalidate })
  const reconnect = trpc.mcp.reconnect.useMutation({ onSettled: invalidate })
  const setEnabled = trpc.mcp.setEnabled.useMutation({ onSettled: invalidate })

  if (!live) {
    return (
      <div className="rounded border border-border px-2 py-1.5 text-[11px] text-muted-foreground">
        Open a chat in this project to query live MCP server status.
      </div>
    )
  }
  const servers = status.data ?? []
  return (
    <div className="space-y-1.5">
      {status.error && (
        <div className="text-xs text-destructive selectable">{status.error.message}</div>
      )}
      {servers.length === 0 && !status.isLoading && !status.error && (
        <div className="text-[11px] text-muted-foreground">No MCP servers loaded.</div>
      )}
      {servers.some((s) => s.globalKillSwitch) && (
        <div className="rounded border border-amber-600/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-500">
          All MCP servers are disabled by the global kill switch (mcp-state.json, shared with the
          CLI). Per-server settings take effect once it is lifted.
        </div>
      )}
      {servers.map((s) => {
        // The SDK resolves authentication with a status instead of rejecting;
        // a user-cancelled flow carries cancelled so its error isn't alarming.
        const statusEl = s.disabled ? (
          <span className="text-muted-foreground">
            Disabled
            {s.globalKillSwitch
              ? ' (global kill switch)'
              : s.disabledScope === 'project'
                ? ' (project override)'
                : ' (global default)'}
          </span>
        ) : s.connecting ? (
          <span className="text-muted-foreground">Connecting…</span>
        ) : s.connected ? (
          <span className="text-green-600 dark:text-green-500">
            Connected · {s.toolCount} tool{s.toolCount === 1 ? '' : 's'}
          </span>
        ) : s.authenticating ? (
          <span className="text-amber-600 dark:text-amber-500">Authenticating…</span>
        ) : s.needsAuth ? (
          <span className="text-amber-600 dark:text-amber-500">Needs authentication</span>
        ) : s.cancelled ? (
          <span className="text-muted-foreground">Authentication cancelled</span>
        ) : s.error ? (
          <span className="text-destructive" title={s.error}>
            {s.error.length > 80 ? `${s.error.slice(0, 80)}…` : s.error}
          </span>
        ) : (
          <span className="text-muted-foreground">Not connected</span>
        )
        return (
          <div key={s.name} className="rounded border border-border px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={s.name}>
                {s.name}
              </span>
              <span className="text-[10px] text-muted-foreground">{s.transport}</span>
              <Tip
                content={
                  scope === 'project'
                    ? 'Override this server for this project, or inherit the global default — persisted in mcp-state.json, shared with the CLI'
                    : 'Set this server’s global default (projects can override it) — persisted in mcp-state.json, shared with the CLI'
                }
              >
                <span className="inline-flex">
                  <select
                    value={
                      scope === 'project'
                        ? (s.projectOverride ?? 'inherit')
                        : (s.globalDefault ?? (s.disabled ? 'disabled' : 'enabled'))
                    }
                    disabled={setEnabled.isPending}
                    onChange={(e) =>
                      setEnabled.mutate({
                        subchatId,
                        serverName: s.name,
                        mode: e.target.value as 'enabled' | 'disabled' | 'inherit',
                        global: scope === 'global' ? true : undefined
                      })
                    }
                    className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px]"
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                    {scope === 'project' && (
                      <option value="inherit">
                        Inherit (
                        {(s.globalDefault ?? 'enabled') === 'enabled' ? 'enabled' : 'disabled'})
                      </option>
                    )}
                  </select>
                </span>
              </Tip>
              {!s.disabled && s.needsAuth && !s.authenticating && (
                <Tip content="Run the OAuth flow for this server in your browser, then reconnect it">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={authenticate.isPending}
                      onClick={() => authenticate.mutate({ subchatId, serverName: s.name })}
                    >
                      Authenticate
                    </Button>
                  </span>
                </Tip>
              )}
              {s.authenticating && (
                <Tip content="Cancel the pending authentication — the server returns to “needs authentication” and can be retried">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={cancelAuth.isPending}
                      onClick={() => cancelAuth.mutate({ subchatId, serverName: s.name })}
                    >
                      Cancel
                    </Button>
                  </span>
                </Tip>
              )}
              {!s.disabled &&
                !s.connected &&
                !s.needsAuth &&
                !s.authenticating &&
                !s.connecting && (
                  <Tip content="Retry the connection to this server">
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        disabled={reconnect.isPending}
                        onClick={() => reconnect.mutate({ subchatId, serverName: s.name })}
                      >
                        Reconnect
                      </Button>
                    </span>
                  </Tip>
                )}
            </div>
            <div className="mt-0.5 text-[10px]">{statusEl}</div>
            {s.authenticating && authUrls[s.name] && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                Browser didn&apos;t open?{' '}
                <a
                  href={authUrls[s.name]}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  Open the authorization page
                </a>
              </div>
            )}
          </div>
        )
      })}
      {(authenticate.error ?? cancelAuth.error ?? reconnect.error ?? setEnabled.error) && (
        <div className="text-xs text-destructive selectable">
          {(authenticate.error ?? cancelAuth.error ?? reconnect.error ?? setEnabled.error)?.message}
        </div>
      )}
    </div>
  )
}

/**
 * settings.json `mcp` toggles for opt-in discovery of MCP servers configured
 * for other coding agents on this machine (Claude Code's ~/.claude.json and
 * Codex's config). Hosts read them at boot — restart to apply.
 */
function McpDiscoverySection({ markDirty }: { markDirty: () => void }): React.JSX.Element {
  const utils = trpc.useUtils()
  const settings = trpc.mastraSettings.get.useQuery()
  const setDiscovery = trpc.mastraSettings.setMcpDiscovery.useMutation({
    onSuccess: () => {
      markDirty()
      utils.mastraSettings.get.invalidate()
    }
  })
  const mcp = settings.data?.mcp
  return (
    <div className="space-y-2 rounded border border-border px-3 py-2.5">
      <div>
        <div className="text-xs font-medium">Global server discovery</div>
        <div className="text-[11px] text-muted-foreground">
          Opt in to also loading MCP servers configured for other coding agents on this machine.
          Stored in <code>settings.json</code>; running agents pick it up after a restart.
        </div>
      </div>
      <Tip content="Also load the global MCP servers from Claude Code's configuration in new agent sessions — restart running agents to apply">
        <label className="flex w-fit items-center gap-2 text-xs">
          <Switch
            checked={mcp?.claudeCodeGlobal === true}
            disabled={setDiscovery.isPending || settings.isLoading}
            onCheckedChange={(v) => setDiscovery.mutate({ claudeCodeGlobal: v })}
          />
          Discover Claude Code MCP servers
        </label>
      </Tip>
      <Tip content="Also load the global MCP servers from Codex's configuration in new agent sessions — restart running agents to apply">
        <label className="flex w-fit items-center gap-2 text-xs">
          <Switch
            checked={mcp?.codexGlobal === true}
            disabled={setDiscovery.isPending || settings.isLoading}
            onCheckedChange={(v) => setDiscovery.mutate({ codexGlobal: v })}
          />
          Discover Codex MCP servers
        </label>
      </Tip>
      {setDiscovery.error && (
        <div className="text-xs text-destructive selectable">{setDiscovery.error.message}</div>
      )}
    </div>
  )
}

export function McpTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const currentProjectId = useAtomValue(selectedProjectIdAtom)
  const selectedSubchatId = useAtomValue(selectedSubchatIdAtom)
  const [scope, setScope] = useState<Scope>('global')
  const [projectId, setProjectId] = useState<string | null>(currentProjectId)
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { markDirty, banner } = useRestartBanner()

  const projects = trpc.projects.list.useQuery()
  const activeProjects = (projects.data ?? []).filter((p) => !p.archived)
  const project = activeProjects.find((p) => p.id === projectId) ?? null
  const projectPath = project?.path
  const scopeReady = scope === 'global' || !!projectPath

  const servers = trpc.mcp.get.useQuery(scope === 'project' ? { projectPath } : {}, {
    enabled: scopeReady
  })

  useEffect(() => {
    if (servers.data && !dirty) setText(JSON.stringify(servers.data, null, 2))
  }, [servers.data, dirty])

  const save = trpc.mcp.set.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.mcp.get.invalidate()
    }
  })

  const resetEditor = (): void => {
    setText('')
    setDirty(false)
    setError(null)
  }
  const switchScope = (next: Scope): void => {
    setScope(next)
    resetEditor()
  }
  const switchProject = (id: string): void => {
    setProjectId(id)
    resetEditor()
  }

  // Live status source: the shared utility host for the global scope; for
  // project scope, the open chat's agent — only available when the picked
  // project is the currently selected one.
  const live =
    scope === 'global' || (!!project && project.id === currentProjectId && !!selectedSubchatId)
  const statusSubchatId = scope === 'project' ? selectedSubchatId : null

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        MCP servers come from <code>~/.mastracode/mcp.json</code> (global, shared with the CLI) and
        a project&apos;s <code>.mastracode/mcp.json</code> (merged over global).
      </div>
      <div className="flex items-center gap-1">
        {(
          [
            ['global', 'Global', 'Servers in ~/.mastracode/mcp.json — available in every project'],
            [
              'project',
              'Project',
              "Servers in a project's .mastracode/mcp.json — that project only"
            ]
          ] as Array<[Scope, string, string]>
        ).map(([id, label, tip]) => (
          <Tip key={id} content={tip}>
            <button
              onClick={() => switchScope(id)}
              className={cn(
                'rounded px-2 py-1 text-[11px] cursor-pointer',
                scope === id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50'
              )}
            >
              {label}
            </button>
          </Tip>
        ))}
        {scope === 'project' && activeProjects.length > 0 && (
          <Tip content="Which project's .mastracode/mcp.json to manage">
            <span className="inline-flex">
              <select
                value={project?.id ?? ''}
                onChange={(e) => switchProject(e.target.value)}
                className="ml-1 rounded border border-border bg-background px-2 py-1 text-[11px]"
              >
                {!project && <option value="">Select a project…</option>}
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id} title={p.path}>
                    {p.name}
                  </option>
                ))}
              </select>
            </span>
          </Tip>
        )}
      </div>
      {!scopeReady && (
        <div className="px-2 py-2 text-[11px] text-muted-foreground">
          {activeProjects.length === 0
            ? 'No projects yet — add a project first to configure project-specific MCP servers.'
            : 'Select a project to manage its MCP servers.'}
        </div>
      )}
      {scopeReady && (
        <>
          <div className="text-[11px] text-muted-foreground">
            {scope === 'global' ? (
              <>
                Edits <code>~/.mastracode/mcp.json</code>. All agent processes restart on save.
              </>
            ) : (
              <>
                Edits <code>.mastracode/mcp.json</code> in the selected project. That project&apos;s
                agents restart on save.
              </>
            )}
          </div>
          <Textarea
            rows={12}
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
            <Tip content="Write mcp.json and restart the affected agent processes so the new servers load">
              <span className="inline-flex">
                <Button
                  size="sm"
                  disabled={!dirty || save.isPending}
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(text) as Record<string, Record<string, unknown>>
                      save.mutate({
                        servers: parsed,
                        projectPath: scope === 'project' ? projectPath : undefined
                      })
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
          <div className="pt-1 text-xs font-medium">Server status</div>
          <McpStatusSection subchatId={statusSubchatId} live={live} scope={scope} />
          {scope === 'global' && (
            <>
              {banner}
              <McpDiscoverySection markDirty={markDirty} />
            </>
          )}
        </>
      )}
    </div>
  )
}
