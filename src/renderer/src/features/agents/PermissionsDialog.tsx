/**
 * Tool-permission editor for the active agent session (/permissions).
 * Category and per-tool policies persist in mastracode session state;
 * "always allow" grants are in-memory and reset on agent restart.
 */
import React, { useState } from 'react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Tip } from '../../components/ui/tooltip'

type Policy = 'allow' | 'ask' | 'deny'
const POLICIES: Policy[] = ['allow', 'ask', 'deny']
const POLICY_TIPS: Record<Policy, string> = {
  allow: 'Run automatically without asking',
  ask: 'Ask for approval before each use',
  deny: 'Block — the agent cannot use it'
}
const CATEGORIES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'read', label: 'Read', hint: 'File reads, searches, listings' },
  { id: 'edit', label: 'Edit', hint: 'File writes and edits' },
  { id: 'execute', label: 'Execute', hint: 'Shell and process execution' },
  { id: 'mcp', label: 'MCP', hint: 'MCP server tools' },
  { id: 'other', label: 'Other', hint: 'Uncategorized tools' }
]

function PolicySegments({
  value,
  disabled,
  onChange
}: {
  value: Policy
  disabled?: boolean
  onChange: (p: Policy) => void
}): React.JSX.Element {
  return (
    <div className="flex overflow-hidden rounded border border-border">
      {POLICIES.map((p) => (
        <Tip key={p} content={POLICY_TIPS[p]}>
          <button
            disabled={disabled}
            onClick={() => onChange(p)}
            className={cn(
              'px-2 py-0.5 text-[11px] capitalize cursor-pointer disabled:cursor-default',
              value === p
                ? p === 'deny'
                  ? 'bg-destructive/15 font-medium text-destructive'
                  : 'bg-accent font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {p}
          </button>
        </Tip>
      ))}
    </div>
  )
}

export function PermissionsDialog({
  subchatId,
  open,
  onOpenChange
}: {
  subchatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const perms = trpc.agent.getPermissions.useQuery({ subchatId }, { enabled: open })
  const setPermission = trpc.agent.setPermission.useMutation({
    onSuccess: (snapshot) => {
      utils.agent.getPermissions.setData({ subchatId }, snapshot)
    }
  })
  const [newTool, setNewTool] = useState('')

  const snapshot = perms.data
  const toolNames = Object.keys(snapshot?.tools ?? {}).sort()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Tool permissions</DialogTitle>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="text-[11px] text-muted-foreground">
            Policies apply to this agent session and persist with its session state. Per-tool
            policies override category policies.
          </div>

          {perms.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
          {perms.error && (
            <div className="text-xs text-destructive selectable">{perms.error.message}</div>
          )}

          {snapshot && (
            <>
              <div>
                <div className="mb-1.5 text-xs font-medium">Categories</div>
                <div className="space-y-1">
                  {CATEGORIES.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs">{c.label}</span>
                        <span className="ml-2 text-[10px] text-muted-foreground">{c.hint}</span>
                      </div>
                      <PolicySegments
                        value={(snapshot.categories[c.id] as Policy | undefined) ?? 'ask'}
                        disabled={setPermission.isPending}
                        onChange={(policy) =>
                          setPermission.mutate({ subchatId, scope: 'category', name: c.id, policy })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium">Per-tool overrides</div>
                <div className="space-y-1">
                  {toolNames.map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{name}</span>
                      <PolicySegments
                        value={(snapshot.tools[name] as Policy | undefined) ?? 'ask'}
                        disabled={setPermission.isPending}
                        onChange={(policy) =>
                          setPermission.mutate({ subchatId, scope: 'tool', name, policy })
                        }
                      />
                    </div>
                  ))}
                  {toolNames.length === 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      No per-tool overrides. “Always allow” on an approval prompt adds one.
                    </div>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="Tool name (e.g. shell_execute)"
                    value={newTool}
                    onChange={(e) => setNewTool(e.target.value)}
                    className="font-mono text-[11px]"
                  />
                  <Tip content="Add a per-tool override that auto-approves this tool">
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        disabled={!newTool.trim() || setPermission.isPending}
                        onClick={() => {
                          setPermission.mutate({
                            subchatId,
                            scope: 'tool',
                            name: newTool.trim(),
                            policy: 'allow'
                          })
                          setNewTool('')
                        }}
                      >
                        Allow tool
                      </Button>
                    </span>
                  </Tip>
                </div>
              </div>

              {(snapshot.grantedCategories.length > 0 || snapshot.grantedTools.length > 0) && (
                <div>
                  <div className="mb-1.5 text-xs font-medium">Session grants</div>
                  <div className="mb-1 text-[11px] text-muted-foreground">
                    Granted via “always allow” during this run; reset when the agent restarts.
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {snapshot.grantedCategories.map((c) => (
                      <span key={c} className="rounded bg-accent px-1.5 py-0.5 text-[10px]">
                        category: {c}
                      </span>
                    ))}
                    {snapshot.grantedTools.map((t) => (
                      <span key={t} className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {setPermission.error && (
            <div className="text-xs text-destructive selectable">{setPermission.error.message}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
