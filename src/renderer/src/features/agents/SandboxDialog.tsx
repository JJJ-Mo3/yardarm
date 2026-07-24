/**
 * Sandbox & session settings for the active agent session (/sandbox).
 * Edits mastracode session state (sandbox allowed paths, smart editing,
 * completion notifications) plus Yardarm's per-chat full sandbox mode
 * (OS-level isolation for shell commands).
 */
import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
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
import type { SessionMeta } from '../../../../shared/ui-message'

const NOTIFICATIONS = ['off', 'bell', 'system', 'both'] as const
type NotificationsMode = (typeof NOTIFICATIONS)[number]

export function SandboxDialog({
  subchatId,
  meta,
  open,
  onOpenChange
}: {
  subchatId: string
  meta: SessionMeta
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
  const setSandbox = trpc.agent.setSandbox.useMutation()
  const [newPath, setNewPath] = useState('')

  const info = state.data
  const paths = info?.sandboxAllowedPaths ?? []
  const isolationAvailable = meta.isolationAvailable !== false
  const sandboxOn = meta.fullSandbox ?? false
  const networkOn = meta.sandboxNetwork ?? true
  // Truthful status: prefer the live mutation error, fall back to the last
  // host-reported failure (e.g. isolation failed to apply at boot).
  const sandboxError = setSandbox.error?.message ?? meta.sandboxError

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Sandbox &amp; session settings</DialogTitle>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2 rounded border border-border p-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">Full sandbox (OS isolation)</div>
                <div className="text-[10px] text-muted-foreground">
                  {isolationAvailable
                    ? 'Run agent shell commands inside an OS sandbox (macOS seatbelt / Linux bubblewrap)'
                    : 'Not available on this system — requires macOS (seatbelt) or Linux with bubblewrap installed'}
                </div>
              </div>
              <Tip
                content={
                  isolationAvailable
                    ? 'OS-isolate approved shell commands: writes are contained to this chat’s worktree, the allowed paths below, and temp dirs'
                    : 'OS-level sandboxing is only supported on macOS (built-in seatbelt) and Linux (needs the bwrap package)'
                }
              >
                <span className="inline-flex">
                  <Switch
                    checked={sandboxOn}
                    disabled={setSandbox.isPending || !isolationAvailable}
                    onCheckedChange={(enabled) =>
                      setSandbox.mutate({ subchatId, enabled, allowNetwork: networkOn })
                    }
                  />
                </span>
              </Tip>
            </div>
            <div className="flex items-center gap-2">
              <div className={cn('min-w-0 flex-1', !sandboxOn && 'opacity-50')}>
                <div className="text-xs">Allow network</div>
                <div className="text-[10px] text-muted-foreground">
                  Whether sandboxed commands may reach the network (all-or-nothing)
                </div>
              </div>
              <Tip content="Turn off to block all network access for sandboxed shell commands — installs, fetches, and pushes will fail">
                <span className="inline-flex">
                  <Switch
                    checked={networkOn}
                    disabled={setSandbox.isPending || !sandboxOn || !isolationAvailable}
                    onCheckedChange={(allowNetwork) =>
                      setSandbox.mutate({ subchatId, enabled: true, allowNetwork })
                    }
                  />
                </span>
              </Tip>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Contains what shell commands can <span className="font-medium">write</span> (worktree
              + allowed paths + temp); reads are not restricted. The agent can still request more
              writable folders via request_access — grants apply live. Yardarm-only; persists with
              this chat.
            </div>
            {sandboxError && (
              <div className="text-[11px] text-destructive selectable">{sandboxError}</div>
            )}
          </div>

          <div className="text-[11px] text-muted-foreground">
            The settings below persist with this agent session&apos;s state (shared with the
            mastracode CLI for the same thread).
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
