/**
 * /prune confirm dialog — runs mastracode storage maintenance (the CLI's
 * /prune command) via agent.prune. Every running agent host is stopped for
 * the duration, so the dialog warns before running and shows the returned
 * maintenance log afterwards. Shared by the ChatView slash command and the
 * Settings → About "Prune storage" button.
 */
import React, { useState } from 'react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'

export function PruneStorageDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [vacuum, setVacuum] = useState(false)
  const [keepMemory, setKeepMemory] = useState(true)
  const [log, setLog] = useState<string[] | null>(null)
  const prune = trpc.agent.prune.useMutation({ onSuccess: (result) => setLog(result.log) })

  const close = (next: boolean): void => {
    if (prune.isPending) return
    if (!next) {
      // Fresh confirm state next time — keep the switches, drop the results.
      setLog(null)
      prune.reset()
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Prune mastracode storage</DialogTitle>
        <div className="space-y-3">
          <div className="text-[11px] text-muted-foreground">
            Deletes old data from mastracode&apos;s local storage (shared with the CLI): traces and
            logs older than 14 days, scorer and workflow data older than 30 days, and chat threads
            older than 90 days.
          </div>
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
            Stops all running agents while pruning — in-flight turns are interrupted. Agents restart
            on their next message.
          </div>

          {!log && (
            <>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs">Keep agent memory</div>
                  <div className="text-[10px] text-muted-foreground">
                    Preserve observational-memory data instead of pruning it
                  </div>
                </div>
                <Tip content="Turn off to also prune stored observations and reflections — agents lose long-term memory of past sessions">
                  <span className="inline-flex">
                    <Switch
                      checked={keepMemory}
                      disabled={prune.isPending}
                      onCheckedChange={setKeepMemory}
                    />
                  </span>
                </Tip>
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs">Compact database files (VACUUM)</div>
                  <div className="text-[10px] text-muted-foreground">
                    Reclaims disk space after pruning — slower
                  </div>
                </div>
                <Tip content="Rebuild the storage database after pruning so freed space is returned to the OS">
                  <span className="inline-flex">
                    <Switch
                      checked={vacuum}
                      disabled={prune.isPending}
                      onCheckedChange={setVacuum}
                    />
                  </span>
                </Tip>
              </div>
            </>
          )}

          {log && (
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-border bg-muted/30 p-2">
              {log.length === 0 && (
                <div className="text-[11px] text-muted-foreground">Nothing to prune.</div>
              )}
              {log.map((line, i) => (
                <div key={i} className="font-mono text-[10px] selectable">
                  {line}
                </div>
              ))}
            </div>
          )}

          {prune.error && (
            <div className="text-xs text-destructive selectable">{prune.error.message}</div>
          )}

          <div className="flex justify-end gap-2">
            {!log && (
              <>
                <Tip content="Close without pruning anything">
                  <span className="inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={prune.isPending}
                      onClick={() => close(false)}
                    >
                      Cancel
                    </Button>
                  </span>
                </Tip>
                <Tip content="Stop all running agents and prune mastracode storage now">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      disabled={prune.isPending}
                      onClick={() => prune.mutate({ vacuum, keepMemory })}
                    >
                      {prune.isPending ? 'Pruning…' : 'Prune storage'}
                    </Button>
                  </span>
                </Tip>
              </>
            )}
            {log && (
              <Tip content="Close the prune results">
                <span className="inline-flex">
                  <Button size="sm" onClick={() => close(false)}>
                    Done
                  </Button>
                </span>
              </Tip>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
