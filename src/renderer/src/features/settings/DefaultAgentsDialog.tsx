/**
 * Catalog dialog for installing Yardarm's built-in default subagents
 * (team roles + domain specialists) into the global or a project's agents
 * directory. Already-installed ids are marked and skipped — installs never
 * overwrite existing files, so customized agents are safe.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { Tip } from '../../components/ui/tooltip'

interface DefaultAgentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scopeInput: { scope: 'global' | 'project'; projectPath: string | undefined }
  scopeLabel: string
  installedIds: ReadonlySet<string>
  onInstalled: () => void
}

const GROUPS = [
  ['role', 'Role subagents'],
  ['specialist', 'Domain specialists']
] as const

export function DefaultAgentsDialog({
  open,
  onOpenChange,
  scopeInput,
  scopeLabel,
  installedIds,
  onInstalled
}: DefaultAgentsDialogProps): React.JSX.Element {
  const catalog = trpc.projectConfig.agentDefaultsCatalog.useQuery(undefined, {
    staleTime: Infinity
  })
  const entries = useMemo(() => catalog.data ?? [], [catalog.data])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const installable = entries.filter((e) => !installedIds.has(e.id))

  // Preselect everything not yet installed each time the dialog opens.
  useEffect(() => {
    if (open) setSelected(new Set(entries.filter((e) => !installedIds.has(e.id)).map((e) => e.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/catalog load
  }, [open, entries])

  const install = trpc.projectConfig.agentsInstallDefaults.useMutation({
    onSuccess: () => {
      onInstalled()
      onOpenChange(false)
    }
  })

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Default subagents</DialogTitle>
        <DialogDescription>
          Ready-made subagents installed as editable files into {scopeLabel}. Agents you already
          have are skipped — installing never overwrites your customizations.
        </DialogDescription>
        <div className="mt-2 flex items-center gap-2">
          <Tip content="Select every default that isn't installed yet">
            <span className="inline-flex">
              <Button
                size="sm"
                variant="outline"
                disabled={installable.length === 0}
                onClick={() => setSelected(new Set(installable.map((e) => e.id)))}
              >
                Select all
              </Button>
            </span>
          </Tip>
          <Tip content="Clear the selection">
            <span className="inline-flex">
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                Select none
              </Button>
            </span>
          </Tip>
        </div>
        <div className="mt-2 max-h-[55vh] space-y-1 overflow-y-auto pr-1">
          {GROUPS.map(([group, heading]) => (
            <React.Fragment key={group}>
              <div className="px-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {heading}
              </div>
              {entries
                .filter((e) => e.group === group)
                .map((e) => {
                  const isInstalled = installedIds.has(e.id)
                  return (
                    <Tip
                      key={e.id}
                      content={
                        isInstalled
                          ? 'Already installed — existing agent files are never overwritten'
                          : `Install ${e.name} as ${e.id}.md`
                      }
                    >
                      <label
                        className={
                          'flex items-start gap-2 rounded px-1 py-1 text-[11px] ' +
                          (isInstalled ? 'opacity-60' : 'cursor-pointer hover:bg-accent/50')
                        }
                      >
                        <input
                          type="checkbox"
                          className="accent-primary mt-0.5"
                          checked={isInstalled || selected.has(e.id)}
                          disabled={isInstalled || install.isPending}
                          onChange={() => toggle(e.id)}
                        />
                        <span className="min-w-0">
                          <span className="font-medium">{e.name}</span>
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                            {e.id}
                          </span>
                          {isInstalled && (
                            <span className="ml-1.5 rounded bg-accent px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                              Installed
                            </span>
                          )}
                          <span className="block text-[10px] text-muted-foreground">
                            {e.description}
                          </span>
                        </span>
                      </label>
                    </Tip>
                  )
                })}
            </React.Fragment>
          ))}
          {catalog.isLoading && (
            <div className="px-1 py-2 text-[11px] text-muted-foreground">Loading catalog…</div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Tip
            content={`Write the selected definitions into ${scopeLabel} and restart the affected agent hosts`}
          >
            <span className="inline-flex">
              <Button
                size="sm"
                disabled={selected.size === 0 || install.isPending}
                onClick={() => install.mutate({ ...scopeInput, ids: [...selected] })}
              >
                {install.isPending
                  ? 'Installing…'
                  : `Install ${selected.size} agent${selected.size === 1 ? '' : 's'}`}
              </Button>
            </span>
          </Tip>
          <span className="text-[10px] text-muted-foreground">
            Installing restarts {scopeInput.scope === 'project' ? "this project's" : 'all'} agent
            hosts so the new definitions take effect.
          </span>
        </div>
        {install.error && (
          <div className="mt-2 text-xs text-destructive selectable">{install.error.message}</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
