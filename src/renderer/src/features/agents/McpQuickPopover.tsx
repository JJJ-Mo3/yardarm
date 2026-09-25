/**
 * Quick-access MCP popover opened from the chat header's "⋯" menu: live
 * per-server status from this chat's agent host with an enable/disable
 * switch per server (a per-project override in mcp-state.json, like the
 * Settings → MCP Servers project scope), plus a shortcut to the full editor.
 */
import React from 'react'
import { useSetAtom } from 'jotai'
import { trpc } from '../../lib/trpc'
import { settingsOpenAtom, settingsTabAtom } from '../../lib/atoms'
import { Popover, PopoverContent, PopoverVirtualAnchor } from '../../components/ui/popover'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'

export function McpQuickPopover({
  subchatId,
  open,
  onOpenChange,
  anchorRef
}: {
  subchatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Header "⋯" button the popover anchors to (opened from its menu). */
  anchorRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const status = trpc.mcp.status.useQuery(
    { subchatId },
    { enabled: open, refetchInterval: open ? 5000 : false }
  )
  const setEnabled = trpc.mcp.setEnabled.useMutation({
    onSettled: () => utils.mcp.status.invalidate({ subchatId })
  })

  const servers = status.data ?? []
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverVirtualAnchor elementRef={anchorRef} />
      <PopoverContent align="end" className="w-72">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs font-medium">MCP servers</span>
          <Tip content="Open the full MCP servers editor in Settings (add, remove, authenticate)">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                onOpenChange(false)
                setSettingsTab('mcp')
                setSettingsOpen(true)
              }}
            >
              Manage…
            </Button>
          </Tip>
        </div>
        {status.isLoading && (
          <div className="text-[11px] text-muted-foreground">Loading server status…</div>
        )}
        {status.error && (
          <div className="text-[11px] text-destructive selectable">{status.error.message}</div>
        )}
        {!status.isLoading && !status.error && servers.length === 0 && (
          <div className="text-[11px] text-muted-foreground">
            No MCP servers configured. Use Manage… to add some.
          </div>
        )}
        {servers.some((s) => s.globalKillSwitch) && (
          <div className="mb-1.5 rounded border border-amber-600/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-500">
            All MCP servers are disabled by the global kill switch (mcp-state.json).
          </div>
        )}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {servers.map((s) => {
            const statusText = s.disabled
              ? 'Disabled'
              : s.connecting
                ? 'Connecting…'
                : s.connected
                  ? `Connected · ${s.toolCount} tool${s.toolCount === 1 ? '' : 's'}`
                  : s.authenticating
                    ? 'Authenticating…'
                    : s.needsAuth
                      ? 'Needs authentication'
                      : s.error
                        ? s.error.length > 60
                          ? `${s.error.slice(0, 60)}…`
                          : s.error
                        : 'Not connected'
            const statusClass = s.disabled
              ? 'text-muted-foreground'
              : s.connected
                ? 'text-green-600 dark:text-green-500'
                : s.needsAuth || s.authenticating
                  ? 'text-amber-600 dark:text-amber-500'
                  : s.error
                    ? 'text-destructive'
                    : 'text-muted-foreground'
            return (
              <div
                key={s.name}
                className="flex items-center gap-2 rounded border border-border px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium" title={s.name}>
                    {s.name}
                  </div>
                  <div className={`truncate text-[10px] ${statusClass}`} title={statusText}>
                    {statusText}
                  </div>
                </div>
                <Tip
                  content={
                    s.disabled
                      ? 'Enable this server for this project (a project override in mcp-state.json, shared with the CLI) and reconnect it'
                      : 'Disable this server for this project (a project override in mcp-state.json, shared with the CLI)'
                  }
                >
                  <span className="inline-flex shrink-0">
                    <Switch
                      checked={!s.disabled}
                      disabled={setEnabled.isPending || s.globalKillSwitch}
                      onCheckedChange={(v) =>
                        setEnabled.mutate({
                          subchatId,
                          serverName: s.name,
                          mode: v ? 'enabled' : 'disabled'
                        })
                      }
                    />
                  </span>
                </Tip>
              </div>
            )
          })}
        </div>
        {setEnabled.error && (
          <div className="mt-1 text-[11px] text-destructive selectable">
            {setEnabled.error.message}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
