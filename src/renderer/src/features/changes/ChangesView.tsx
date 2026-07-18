import React, { useMemo, useState } from 'react'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import { generateDiffFile } from '@git-diff-view/file'
import {
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  Upload
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { useConfirm } from '../../components/ConfirmDialog'

function statusColor(status: string): string {
  if (status.includes('?')) return 'text-green-500'
  if (status.includes('D')) return 'text-destructive'
  if (status.includes('A')) return 'text-green-500'
  return 'text-amber-500'
}

function FileDiffPanel({ cwd, path }: { cwd: string; path: string }): React.JSX.Element {
  const diff = trpc.git.fileDiff.useQuery({ cwd, path })

  const diffFile = useMemo(() => {
    if (!diff.data || diff.data.binary) return null
    try {
      const file = generateDiffFile(
        diff.data.path,
        diff.data.oldContent,
        diff.data.path,
        diff.data.newContent,
        '',
        ''
      )
      file.initRaw()
      return file
    } catch (err) {
      console.error('diff generation failed', err)
      return null
    }
  }, [diff.data])

  if (diff.isLoading) {
    return <div className="p-4 text-xs text-muted-foreground">Loading diff…</div>
  }
  if (diff.data?.binary) {
    return <div className="p-4 text-xs text-muted-foreground">Binary file</div>
  }
  if (!diffFile) {
    return <div className="p-4 text-xs text-muted-foreground">No diff available</div>
  }
  return (
    <div className="selectable text-xs">
      <DiffView diffFile={diffFile} diffViewMode={DiffModeEnum.Unified} diffViewFontSize={12} />
    </div>
  )
}

export function ChangesView({ cwd }: { cwd: string }): React.JSX.Element {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const status = trpc.git.status.useQuery({ cwd }, { refetchInterval: 4000 })
  const branches = trpc.git.branches.useQuery({ cwd }, { staleTime: 10_000 })
  const ghAvailable = trpc.git.ghAvailable.useQuery(undefined, { staleTime: Infinity })
  const [selected, setSelected] = useState<string | null>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [prOpen, setPrOpen] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')

  const invalidate = (): void => {
    utils.git.status.invalidate({ cwd })
    utils.git.fileDiff.invalidate()
    utils.git.branches.invalidate({ cwd })
  }
  const stage = trpc.git.stage.useMutation({ onSuccess: invalidate })
  const unstage = trpc.git.unstage.useMutation({ onSuccess: invalidate })
  const discard = trpc.git.discard.useMutation({ onSuccess: invalidate })
  const commit = trpc.git.commit.useMutation({
    onSuccess: () => {
      setCommitMsg('')
      invalidate()
    }
  })
  const push = trpc.git.push.useMutation({ onSuccess: invalidate })
  const checkout = trpc.git.checkout.useMutation({ onSuccess: invalidate })
  const createBranch = trpc.git.createBranch.useMutation({
    onSuccess: () => {
      setNewBranchOpen(false)
      setNewBranchName('')
      invalidate()
    }
  })
  const createPr = trpc.git.createPr.useMutation()

  const files = status.data?.files ?? []
  const branchList = branches.data?.all ?? []
  const currentBranch = status.data?.branch ?? ''

  return (
    <div className="flex h-full">
      {/* File list + commit box */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-1 border-b border-border px-2 py-2">
          <Select
            value={currentBranch}
            onValueChange={(branch) => {
              if (branch !== currentBranch) checkout.mutate({ cwd, branch })
            }}
          >
            <SelectTrigger className="h-7 min-w-0 flex-1 font-mono text-[11px]">
              <SelectValue placeholder="branch" />
            </SelectTrigger>
            <SelectContent>
              {(branchList.includes(currentBranch) || !currentBranch
                ? branchList
                : [currentBranch, ...branchList]
              ).map((b) => (
                <SelectItem key={b} value={b} className="font-mono text-[11px]">
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {status.data && status.data.ahead > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              ↑{status.data.ahead}
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            title="New branch"
            onClick={() => setNewBranchOpen(true)}
          >
            <GitBranchPlus size={12} />
          </Button>
          {ghAvailable.data?.available && (
            <Button
              size="icon"
              variant="ghost"
              title="Create pull request (gh)"
              onClick={() => {
                createPr.reset()
                setPrOpen(true)
              }}
            >
              <GitPullRequestArrow size={12} />
            </Button>
          )}
          <Button size="icon" variant="ghost" title="Refresh" onClick={() => invalidate()}>
            <RefreshCw size={12} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {files.length === 0 && (
            <div className="p-4 text-center text-[11px] text-muted-foreground">
              No changes
            </div>
          )}
          {files.map((f) => (
            <div
              key={f.path}
              onClick={() => setSelected(f.path)}
              className={cn(
                'group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1',
                selected === f.path ? 'bg-accent' : 'hover:bg-accent/50'
              )}
            >
              <span className={cn('w-6 font-mono text-[10px]', statusColor(f.status))}>
                {f.status.trim() || 'M'}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{f.path}</span>
              <span className="hidden group-hover:flex items-center gap-0.5">
                {f.staged ? (
                  <button
                    title="Unstage"
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      unstage.mutate({ cwd, paths: [f.path] })
                    }}
                  >
                    <Minus size={11} />
                  </button>
                ) : (
                  <button
                    title="Stage"
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      stage.mutate({ cwd, paths: [f.path] })
                    }}
                  >
                    <Plus size={11} />
                  </button>
                )}
                <button
                  title="Discard changes"
                  className="text-muted-foreground hover:text-destructive cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    void confirmDialog({
                      title: 'Discard changes?',
                      description: `Changes to ${f.path} will be permanently lost.`,
                      confirmLabel: 'Discard'
                    }).then((ok) => {
                      if (ok) discard.mutate({ cwd, paths: [f.path] })
                    })
                  }}
                >
                  <Undo2 size={11} />
                </button>
              </span>
              {f.staged && <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />}
            </div>
          ))}
        </div>
        <div className="border-t border-border p-2 space-y-2">
          <Textarea
            rows={2}
            placeholder="Commit message"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={!commitMsg.trim() || files.length === 0 || commit.isPending}
              onClick={() => commit.mutate({ cwd, message: commitMsg.trim(), stageAll: true })}
            >
              <GitCommitHorizontal size={13} />
              Commit all
            </Button>
            <Button
              size="sm"
              variant="secondary"
              title="Push"
              disabled={push.isPending}
              onClick={() => push.mutate({ cwd })}
            >
              <Upload size={13} />
            </Button>
          </div>
          {(commit.error || push.error || checkout.error) && (
            <div className="text-[11px] text-destructive selectable">
              {commit.error?.message ?? push.error?.message ?? checkout.error?.message}
            </div>
          )}
        </div>
      </div>

      {/* Diff */}
      <div className="min-w-0 flex-1 overflow-auto">
        {selected ? (
          <FileDiffPanel cwd={cwd} path={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Select a file to view its diff
          </div>
        )}
      </div>

      {/* New branch dialog */}
      <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>New branch</DialogTitle>
          <div className="space-y-3">
            <Input
              autoFocus
              placeholder="branch-name"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newBranchName.trim()) {
                  createBranch.mutate({ cwd, branch: newBranchName.trim() })
                }
              }}
            />
            <div className="text-[11px] text-muted-foreground">
              Created from the current HEAD ({currentBranch}) and checked out.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setNewBranchOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!newBranchName.trim() || createBranch.isPending}
                onClick={() => createBranch.mutate({ cwd, branch: newBranchName.trim() })}
              >
                {createBranch.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
            {createBranch.error && (
              <div className="text-[11px] text-destructive selectable">
                {createBranch.error.message}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create PR dialog (gh CLI) */}
      <Dialog open={prOpen} onOpenChange={setPrOpen}>
        <DialogContent>
          <DialogTitle>Create pull request</DialogTitle>
          {createPr.data ? (
            <div className="space-y-3">
              <div className="text-[13px]">Pull request created:</div>
              <a
                href={createPr.data.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-mono text-[12px] text-primary underline"
              >
                {createPr.data.url}
              </a>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setPrOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[11px] text-muted-foreground font-mono">
                {currentBranch} → default branch
              </div>
              <Input
                autoFocus
                placeholder="Title"
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
              />
              <Textarea
                rows={5}
                placeholder="Description"
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPrOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!prTitle.trim() || createPr.isPending}
                  onClick={() =>
                    createPr.mutate({ cwd, title: prTitle.trim(), body: prBody, draft: true })
                  }
                >
                  Draft
                </Button>
                <Button
                  size="sm"
                  disabled={!prTitle.trim() || createPr.isPending}
                  onClick={() => createPr.mutate({ cwd, title: prTitle.trim(), body: prBody })}
                >
                  {createPr.isPending ? 'Creating…' : 'Create PR'}
                </Button>
              </div>
              {createPr.error && (
                <div className="max-h-24 overflow-y-auto text-[11px] text-destructive selectable whitespace-pre-wrap">
                  {createPr.error.message}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
