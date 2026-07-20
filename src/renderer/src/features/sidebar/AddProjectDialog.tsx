import React, { useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { FolderOpen, GitFork } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { addProjectOpenAtom, selectedProjectIdAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Tip } from '../../components/ui/tooltip'

/**
 * Add-project dialog: open an existing local folder (offering `git init`
 * when it isn't a repository yet) or clone a repository from a URL.
 */
export function AddProjectDialog(): React.JSX.Element {
  const [openMode, setOpenMode] = useAtom(addProjectOpenAtom)
  const setProjectId = useSetAtom(selectedProjectIdAtom)
  const utils = trpc.useUtils()

  const mode = openMode === false ? 'local' : openMode
  const [pickedPath, setPickedPath] = useState<string | null>(null)
  const [needsInit, setNeedsInit] = useState(false)
  const [url, setUrl] = useState('')
  const [parentDir, setParentDir] = useState<string | null>(null)

  const pickFolder = trpc.projects.pickFolder.useMutation()
  const add = trpc.projects.add.useMutation({
    onSuccess: (res) => {
      if (res.ok) finish(res.project.id)
      else setNeedsInit(true)
    }
  })
  const clone = trpc.projects.cloneFromUrl.useMutation({
    onSuccess: (p) => finish(p.id)
  })

  function reset(): void {
    setPickedPath(null)
    setNeedsInit(false)
    setUrl('')
    setParentDir(null)
    pickFolder.reset()
    add.reset()
    clone.reset()
  }

  function finish(projectId: string): void {
    void utils.projects.list.invalidate()
    setProjectId(projectId)
    reset()
    setOpenMode(false)
  }

  function chooseLocalFolder(): void {
    setNeedsInit(false)
    add.reset()
    void pickFolder.mutateAsync({ title: 'Select a project folder' }).then((p) => {
      if (!p) return
      setPickedPath(p)
      add.mutate({ path: p, init: false })
    })
  }

  const busy = pickFolder.isPending || add.isPending || clone.isPending
  const error = add.error?.message ?? clone.error?.message ?? pickFolder.error?.message ?? null

  return (
    <Dialog
      open={openMode !== false}
      onOpenChange={(o) => {
        if (!o) {
          setOpenMode(false)
          reset()
        }
      }}
    >
      <DialogContent>
        <DialogTitle>Add project</DialogTitle>
        <div className="space-y-3">
          {/* Mode switch */}
          <div className="flex gap-0.5 rounded-md bg-accent/40 p-0.5">
            {(
              [
                {
                  id: 'local',
                  label: 'Local folder',
                  icon: <FolderOpen size={12} />,
                  tip: 'Use a folder already on this machine'
                },
                {
                  id: 'clone',
                  label: 'Clone from GitHub',
                  icon: <GitFork size={12} />,
                  tip: 'Download a repository from a git URL into a local folder'
                }
              ] as const
            ).map((m) => (
              <Tip key={m.id} content={m.tip}>
                <button
                  onClick={() => setOpenMode(m.id)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs cursor-pointer',
                    mode === m.id
                      ? 'bg-background font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m.icon}
                  {m.label}
                </button>
              </Tip>
            ))}
          </div>

          {mode === 'local' ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Pick a folder on this machine. It must be (or become) a git repository.
              </div>
              <Button
                variant="outline"
                className="w-full justify-start font-mono text-xs"
                disabled={busy}
                onClick={chooseLocalFolder}
              >
                <FolderOpen size={14} />
                <span className="truncate">{pickedPath ?? 'Choose folder…'}</span>
              </Button>
              {needsInit && pickedPath && (
                <div className="space-y-2 rounded-md border border-border bg-accent/30 p-3 text-xs">
                  <div>
                    This folder isn&apos;t a git repository yet. Yardarm needs git for checkpoints,
                    worktrees, and the Changes view.
                  </div>
                  <Tip content="Runs git init and creates an initial commit so chats can use isolated worktrees">
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        disabled={add.isPending}
                        onClick={() => add.mutate({ path: pickedPath, init: true })}
                      >
                        {add.isPending ? 'Initializing…' : 'Initialize git repository here'}
                      </Button>
                    </span>
                  </Tip>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                autoFocus
                placeholder="https://github.com/owner/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button
                variant="outline"
                className="w-full justify-start font-mono text-xs"
                disabled={busy}
                onClick={() => {
                  void pickFolder
                    .mutateAsync({ title: 'Clone into which folder?' })
                    .then((p) => p && setParentDir(p))
                }}
              >
                <FolderOpen size={14} />
                <span className="truncate">{parentDir ?? 'Choose destination folder…'}</span>
              </Button>
              {parentDir && url.trim() && (
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  → {parentDir}/
                  {url
                    .trim()
                    .replace(/\/+$/, '')
                    .split(/[/:]/)
                    .pop()
                    ?.replace(/\.git$/, '')}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  disabled={!url.trim() || !parentDir || busy}
                  onClick={() => parentDir && clone.mutate({ url: url.trim(), parentDir })}
                >
                  {clone.isPending ? 'Cloning…' : 'Clone'}
                </Button>
              </div>
            </div>
          )}

          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
