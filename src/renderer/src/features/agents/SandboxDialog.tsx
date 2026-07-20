/**
 * Sandbox & session settings for the active agent session (/sandbox).
 * Edits mastracode session state: sandbox allowed paths, smart editing,
 * and completion notifications.
 */
import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'

const NOTIFICATIONS = ['off', 'bell', 'system', 'both'] as const
type NotificationsMode = (typeof NOTIFICATIONS)[number]

export function SandboxDialog({
  subchatId,
  open,
  onOpenChange
}: {
  subchatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const state = trpc.agent.stateGet.useQuery({ subchatId }, { enabled: open })
  const stateSet = trpc.agent.stateSet.useMutation({
    onSuccess: (snapshot) => {
      utils.agent.stateGet.setData({ subchatId }, snapshot)
    }
  })
  const [newPath, setNewPath] = useState('')

  const info = state.data
  const paths = info?.sandboxAllowedPaths ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Sandbox &amp; session settings</DialogTitle>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="text-[11px] text-muted-foreground">
            These settings persist with this agent session&apos;s state (shared with the mastracode
            CLI for the same thread).
          </div>

          {state.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
          {state.error && (
            <div className="text-xs text-destructive selectable">{state.error.message}</div>
          )}

          {info && (
            <>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs">Smart editing</div>
                  <div className="text-[10px] text-muted-foreground">
                    Model-assisted recovery for failed file edits
                  </div>
                </div>
                <Tip content="When a file edit fails to apply, let a model repair and retry it automatically">
                  <span className="inline-flex">
                    <Switch
                      checked={info.smartEditing ?? false}
                      disabled={stateSet.isPending}
                      onCheckedChange={(smartEditing) =>
                        stateSet.mutate({ subchatId, patch: { smartEditing } })
                      }
                    />
                  </span>
                </Tip>
              </div>

              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs">Notifications</div>
                  <div className="text-[10px] text-muted-foreground">
                    Alert when the agent finishes a run
                  </div>
                </div>
                <Select
                  value={(info.notifications as NotificationsMode | undefined) ?? 'off'}
                  disabled={stateSet.isPending}
                  onValueChange={(v) =>
                    stateSet.mutate({
                      subchatId,
                      patch: { notifications: v as NotificationsMode }
                    })
                  }
                >
                  <Tip content="How to alert you when a run finishes: bell (in-app sound), system (macOS notification), or both">
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                  </Tip>
                  <SelectContent>
                    {NOTIFICATIONS.map((n) => (
                      <SelectItem key={n} value={n} className="capitalize">
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="mb-1 text-xs font-medium">Sandbox allowed paths</div>
                <div className="mb-1.5 text-[11px] text-muted-foreground">
                  Extra directories sandboxed shell commands may write to (beyond the worktree).
                </div>
                <div className="space-y-1">
                  {paths.map((p) => (
                    <div
                      key={p}
                      className="flex items-center gap-2 rounded border border-border px-2 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{p}</span>
                      <Tip content="Remove this path — sandboxed commands can no longer write to it">
                        <button
                          className="text-muted-foreground hover:text-destructive cursor-pointer"
                          disabled={stateSet.isPending}
                          onClick={() =>
                            stateSet.mutate({
                              subchatId,
                              patch: { sandboxAllowedPaths: paths.filter((x) => x !== p) }
                            })
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </Tip>
                    </div>
                  ))}
                  {paths.length === 0 && (
                    <div className="text-[11px] text-muted-foreground">No extra paths allowed.</div>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="/absolute/path"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    className="font-mono text-[11px]"
                  />
                  <Tip content="Allow sandboxed shell commands to write inside this directory">
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        disabled={!newPath.trim() || stateSet.isPending}
                        onClick={() => {
                          const p = newPath.trim()
                          if (!paths.includes(p)) {
                            stateSet.mutate({
                              subchatId,
                              patch: { sandboxAllowedPaths: [...paths, p] }
                            })
                          }
                          setNewPath('')
                        }}
                      >
                        Add path
                      </Button>
                    </span>
                  </Tip>
                </div>
              </div>
            </>
          )}

          {stateSet.error && (
            <div className="text-xs text-destructive selectable">{stateSet.error.message}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
