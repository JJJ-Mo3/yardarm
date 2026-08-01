import React, { useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { FolderOpen, GitFork } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import {
  addProjectOpenAtom,
  projectSettingsOpenAtom,
  projectSettingsTabAtom,
  selectedProjectIdAtom
} from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Tip } from '../../components/ui/tooltip'

/**
 * Add-project dialog: open an existing local folder (offering `git init`
 * when it isn't a repository yet) or clone a repository from a URL.
 * After the project is created, a second "Set up project" step prompts for
 * project-specific settings (agent instructions) before closing.
 */
export function AddProjectDialog(): React.JSX.Element {
  const [openMode, setOpenMode] = useAtom(addProjectOpenAtom)
  const setProjectId = useSetAtom(selectedProjectIdAtom)
  const setProjectSettingsOpen = useSetAtom(projectSettingsOpenAtom)
  const setProjectSettingsTab = useSetAtom(projectSettingsTabAtom)
  const utils = trpc.useUtils()

  const mode = openMode === false ? 'local' : openMode
  const [pickedPath, setPickedPath] = useState<string | null>(null)
  const [needsInit, setNeedsInit] = useState(false)
  const [url, setUrl] = useState('')
  const [parentDir, setParentDir] = useState<string | null>(null)
  // Second step: the created project awaiting setup, and the instructions
  // draft (null = untouched, falls back to the repo's existing file).
  const [setup, setSetup] = useState<{ projectId: string; projectPath: string } | null>(null)
  const [draft, setDraft] = useState<string | null>(null)

  const pickFolder = trpc.projects.pickFolder.useMutation()
  const add = trpc.projects.add.useMutation({
    onSuccess: (res) => {
      if (res.ok) finish(res.project)
      else setNeedsInit(true)
    }
  })
  const clone = trpc.projects.cloneFromUrl.useMutation({
    onSuccess: (p) => finish(p)
  })
  const instructions = trpc.projectConfig.instructionsGet.useQuery(
    { projectPath: setup?.projectPath ?? '' },
    { enabled: !!setup }
  )
  const saveInstructions = trpc.projectConfig.instructionsSet.useMutation()

  function reset(): void {
    setPickedPath(null)
    setNeedsInit(false)
    setUrl('')
    setParentDir(null)
    setSetup(null)
    setDraft(null)
    pickFolder.reset()
    add.reset()
    clone.reset()
    saveInstructions.reset()
  }

  /** Project created — select it immediately and move to the setup step. */
  function finish(project: { id: string; path: string }): void {
    void utils.projects.list.invalidate()
    setProjectId(project.id)
    setSetup({ projectId: project.id, projectPath: project.path })
  }

  function closeAll(): void {
    reset()
    setOpenMode(false)
  }

  const original = instructions.data?.content ?? ''
  const text = draft ?? original
  // Only write when the user actually changed something, and never create an
  // empty instructions file (skipping with an empty textarea writes nothing).
  const worthSaving = text !== original && (text.trim() !== '' || original !== '')

  /** Finish the setup step, saving instructions first when needed. */
  function finishSetup(openFullSettings: boolean): void {
    const after = (): void => {
      if (openFullSettings) {
        setProjectSettingsTab('general')
        setProjectSettingsOpen(true)
      }
      closeAll()
    }
    if (setup && worthSaving) {
      saveInstructions.mutate(
        { projectPath: setup.projectPath, content: text },
        { onSuccess: after }
      )
    } else {
      after()
    }
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
        <DialogTitle>{setup ? 'Set up project' : 'Add project'}</DialogTitle>
        {setup ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Project added. Optionally give its agents project-specific instructions (coding
              conventions, build commands, gotchas) — saved to{' '}
              <code>.mastracode/agent-instructions.md</code> and shared with the CLI.
            </div>
            {instructions.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : (
              <>
                {instructions.data?.content != null && (
                  <div className="text-[11px] text-muted-foreground">
                    This repository already has instructions — shown below.
                  </div>
                )}
                {(instructions.data?.legacyFiles.length ?? 0) > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Also read by agents: {instructions.data?.legacyFiles.join(', ')}
                  </div>
                )}
                <Textarea
                  autoFocus
                  value={text}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="e.g. Run pnpm test before finishing. Use single quotes. Never touch src/generated/."
                  className="min-h-32 font-mono text-[11px]"
                />
              </>
            )}
            {(instructions.error ?? saveInstructions.error) && (
              <div className="text-xs text-destructive selectable">
                {(instructions.error ?? saveInstructions.error)?.message}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Tip content="Open the full project settings (hooks, commands, plugins, memory) — instructions entered here are saved first">
                <span className="inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saveInstructions.isPending}
                    onClick={() => finishSetup(true)}
                  >
                    More project settings…
                  </Button>
                </span>
              </Tip>
              <div className="flex-1" />
              <Tip content="Finish without saving any instructions">
                <span className="inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saveInstructions.isPending}
                    onClick={() => closeAll()}
                  >
                    Skip
                  </Button>
                </span>
              </Tip>
              <Tip
                content={
                  worthSaving
                    ? 'Save the agent instructions and finish'
                    : 'Finish setup (nothing changed, so nothing is written)'
                }
              >
                <span className="inline-flex">
                  <Button
                    size="sm"
                    disabled={saveInstructions.isPending || instructions.isLoading}
                    onClick={() => finishSetup(false)}
                  >
                    {saveInstructions.isPending ? 'Saving…' : 'Save & finish'}
                  </Button>
                </span>
              </Tip>
            </div>
          </div>
        ) : (
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
                    label: 'Clone repository',
                    icon: <GitFork size={12} />,
                    tip: 'Download a repository from a git URL (GitHub, GitLab, …) into a local folder'
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
                      This folder isn&apos;t a git repository yet. Yardarm needs git for
                      checkpoints, worktrees, and the Changes view.
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
                  placeholder="https://github.com/owner/repo.git or https://gitlab.com/owner/repo.git"
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
        )}
      </DialogContent>
    </Dialog>
  )
}
