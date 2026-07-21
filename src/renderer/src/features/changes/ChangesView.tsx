/**
 * Changes tab: working-tree status with stage/unstage/discard, staged or
 * stage-all commits, push/pull, branch switching, PR creation, a commit
 * history pane (per-commit files + diffs), and merging the chat's worktree
 * branch into the base branch at the project root.
 */
import React, { useMemo, useState } from 'react'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import { generateDiffFile } from '@git-diff-view/file'
import {
  Download,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  Upload
} from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
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
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'

function statusColor(status: string): string {
  if (status.includes('?')) return 'text-green-500'
  if (status.includes('D')) return 'text-destructive'
  if (status.includes('A')) return 'text-green-500'
  return 'text-amber-500'
}

interface DiffData {
  path: string
  oldContent: string
  newContent: string
  binary: boolean
}

/** Shared diff renderer for working-tree and commit diffs. */
function DiffContent({
  diff,
  isLoading
}: {
  diff: DiffData | undefined
  isLoading: boolean
}): React.JSX.Element {
  const diffFile = useMemo(() => {
    if (!diff || diff.binary) return null
    try {
      const file = generateDiffFile(diff.path, diff.oldContent, diff.path, diff.newContent, '', '')
      file.initRaw()
      return file
    } catch (err) {
      console.error('diff generation failed', err)
      return null
    }
  }, [diff])

  if (isLoading) {
    return <div className="p-4 text-xs text-muted-foreground">Loading diff…</div>
  }
  if (diff?.binary) {
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

function FileDiffPanel({ cwd, path }: { cwd: string; path: string }): React.JSX.Element {
  const diff = trpc.git.fileDiff.useQuery({ cwd, path })
  return <DiffContent diff={diff.data} isLoading={diff.isLoading} />
}

function CommitDiffPanel({
  cwd,
  hash,
  path
}: {
  cwd: string
  hash: string
  path: string
}): React.JSX.Element {
  const diff = trpc.git.commitFileDiff.useQuery({ cwd, hash, path })
  return <DiffContent diff={diff.data} isLoading={diff.isLoading} />
}

export interface MergeTarget {
  projectPath: string
  branch: string
  baseBranch: string
}

export function ChangesView({
  cwd,
  merge = null
}: {
  cwd: string
  merge?: MergeTarget | null
}): React.JSX.Element {
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
  const [pane, setPane] = useState<'changes' | 'history'>('changes')
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [commitFile, setCommitFile] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSquash, setMergeSquash] = useState(false)
  const [mergeMsg, setMergeMsg] = useState('')

  const log = trpc.git.log.useQuery({ cwd, limit: 100 }, { enabled: pane === 'history' })
  const commitFilesQuery = trpc.git.commitFiles.useQuery(
    { cwd, hash: selectedCommit ?? '' },
    { enabled: !!selectedCommit }
  )

  const invalidate = (): void => {
    utils.git.status.invalidate({ cwd })
    utils.git.fileDiff.invalidate()
    utils.git.branches.invalidate({ cwd })
    utils.git.log.invalidate({ cwd })
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
  const pullMut = trpc.git.pull.useMutation({ onSuccess: invalidate })
  const mergeMut = trpc.git.mergeIntoBase.useMutation({ onSuccess: invalidate })
  const checkout = trpc.git.checkout.useMutation({ onSuccess: invalidate })
  const createBranch = trpc.git.createBranch.useMutation({
    onSuccess: () => {
      setNewBranchOpen(false)
      setNewBranchName('')
      invalidate()
    }
  })
  const createPr = trpc.git.createPr.useMutation({
    onSuccess: () => {
      // The success screen shows the PR URL; clear the form for the next PR.
      setPrTitle('')
      setPrBody('')
    }
  })

  const files = status.data?.files ?? []
  const branchList = branches.data?.all ?? []
  const currentBranch = status.data?.branch ?? ''
  const stagedCount = files.filter((f) => f.staged).length
  const behind = status.data?.behind ?? 0

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
            <Tip content="Current git branch — select another to check it out">
              <SelectTrigger className="h-7 min-w-0 flex-1 font-mono text-[11px]">
                <SelectValue placeholder="branch" />
              </SelectTrigger>
            </Tip>
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
          {status.data && (status.data.ahead > 0 || behind > 0) && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {status.data.ahead > 0 && <>↑{status.data.ahead}</>}
              {behind > 0 && <>↓{behind}</>}
            </span>
          )}
          <Tip content="Create a new branch from the current HEAD and check it out">
            <Button size="icon" variant="ghost" onClick={() => setNewBranchOpen(true)}>
              <GitBranchPlus size={12} />
            </Button>
          </Tip>
          {ghAvailable.data?.available && (
            <Tip content="Open a pull request for this branch on GitHub (uses the gh CLI)">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  createPr.reset()
                  setPrOpen(true)
                }}
              >
                <GitPullRequestArrow size={12} />
              </Button>
            </Tip>
          )}
          {merge && (
            <Tip content={`Merge ${merge.branch} into ${merge.baseBranch} at the project root`}>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  mergeMut.reset()
                  setMergeOpen(true)
                }}
              >
                <GitMerge size={12} />
              </Button>
            </Tip>
          )}
          <Tip content="Re-read git status, diffs, and branches">
            <Button size="icon" variant="ghost" onClick={() => invalidate()}>
              <RefreshCw size={12} />
            </Button>
          </Tip>
        </div>
        <div className="flex shrink-0 border-b border-border text-[11px]">
          <Tip content="Working-tree changes: stage, discard, commit, push, pull">
            <button
              onClick={() => {
                setPane('changes')
                setSelectedCommit(null)
                setCommitFile(null)
              }}
              className={cn(
                'flex-1 cursor-pointer py-1.5',
                pane === 'changes'
                  ? 'border-b border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Changes
            </button>
          </Tip>
          <Tip content="Commit history of the current branch — click a commit to browse its files">
            <button
              onClick={() => {
                setPane('history')
                setSelectedCommit(null)
                setCommitFile(null)
              }}
              className={cn(
                'flex-1 cursor-pointer py-1.5',
                pane === 'history'
                  ? 'border-b border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              History
            </button>
          </Tip>
        </div>
        {pane === 'history' && (
          <div className="flex-1 overflow-y-auto p-1">
            {(log.data ?? []).length === 0 && (
              <div className="p-4 text-center text-[11px] text-muted-foreground">No commits</div>
            )}
            {(log.data ?? []).map((c) => (
              <div key={c.hash}>
                <div
                  onClick={() => {
                    const next = selectedCommit === c.hash ? null : c.hash
                    setSelectedCommit(next)
                    setCommitFile(null)
                  }}
                  className={cn(
                    'cursor-pointer rounded px-2 py-1',
                    selectedCommit === c.hash ? 'bg-accent' : 'hover:bg-accent/50'
                  )}
                >
                  <div className="truncate text-[11px]" title={c.message}>
                    {c.message}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {c.hash.slice(0, 7)} · {c.author} · {timeAgo(new Date(c.date).getTime())}
                  </div>
                </div>
                {selectedCommit === c.hash &&
                  (commitFilesQuery.data ?? []).map((f) => (
                    <div
                      key={f.path}
                      onClick={() => setCommitFile(f.path)}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded py-0.5 pl-5 pr-2',
                        commitFile === f.path ? 'bg-accent' : 'hover:bg-accent/50'
                      )}
                    >
                      <span className={cn('w-3 font-mono text-[10px]', statusColor(f.status))}>
                        {f.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {f.path}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
        {pane === 'changes' && (
          <>
            <div className="flex-1 overflow-y-auto p-1">
              {files.length === 0 && (
                <div className="p-4 text-center text-[11px] text-muted-foreground">No changes</div>
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
                      <Tip content="Unstage — leave the change in place but drop it from the next commit">
                        <button
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            unstage.mutate({ cwd, paths: [f.path] })
                          }}
                        >
                          <Minus size={11} />
                        </button>
                      </Tip>
                    ) : (
                      <Tip content="Stage this file for the next commit">
                        <button
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            stage.mutate({ cwd, paths: [f.path] })
                          }}
                        >
                          <Plus size={11} />
                        </button>
                      </Tip>
                    )}
                    <Tip content="Discard this file's changes — permanently reverts it">
                      <button
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
                    </Tip>
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
                {stagedCount > 0 ? (
                  <>
                    <Tip content="Commit only the staged files with this message">
                      <span className="flex flex-1">
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={!commitMsg.trim() || commit.isPending}
                          onClick={() =>
                            commit.mutate({ cwd, message: commitMsg.trim(), stageAll: false })
                          }
                        >
                          <GitCommitHorizontal size={13} />
                          Commit staged ({stagedCount})
                        </Button>
                      </span>
                    </Tip>
                    <Tip content="Stage every changed file and commit with this message">
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!commitMsg.trim() || commit.isPending}
                          onClick={() =>
                            commit.mutate({ cwd, message: commitMsg.trim(), stageAll: true })
                          }
                        >
                          All
                        </Button>
                      </span>
                    </Tip>
                  </>
                ) : (
                  <Tip content="Stage every changed file and commit with this message">
                    <span className="flex flex-1">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={!commitMsg.trim() || files.length === 0 || commit.isPending}
                        onClick={() =>
                          commit.mutate({ cwd, message: commitMsg.trim(), stageAll: true })
                        }
                      >
                        <GitCommitHorizontal size={13} />
                        Commit all
                      </Button>
                    </span>
                  </Tip>
                )}
                <Tip content="Pull from the remote (conflicts abort cleanly)">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pullMut.isPending}
                      onClick={() => pullMut.mutate({ cwd })}
                    >
                      <Download size={13} />
                      {behind > 0 && <span className="font-mono text-[10px]">↓{behind}</span>}
                    </Button>
                  </span>
                </Tip>
                <Tip content="Push commits to the remote (sets upstream if needed)">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={push.isPending}
                      onClick={() => push.mutate({ cwd })}
                    >
                      <Upload size={13} />
                    </Button>
                  </span>
                </Tip>
              </div>
              {(commit.error || push.error || pullMut.error || checkout.error) && (
                <div className="text-[11px] text-destructive selectable">
                  {commit.error?.message ??
                    push.error?.message ??
                    pullMut.error?.message ??
                    checkout.error?.message}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Diff */}
      <div className="min-w-0 flex-1 overflow-auto">
        {pane === 'history' ? (
          selectedCommit && commitFile ? (
            <CommitDiffPanel cwd={cwd} hash={selectedCommit} path={commitFile} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Select a commit, then a file
            </div>
          )
        ) : selected ? (
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

      {/* Merge into base dialog */}
      {merge && (
        <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
          <DialogContent className="max-w-sm">
            <DialogTitle>Merge into {merge.baseBranch}</DialogTitle>
            {mergeMut.data ? (
              <div className="space-y-3">
                <div className="text-[13px]">Merged:</div>
                <div className="font-mono text-[12px] selectable">
                  {mergeMut.data.sha.slice(0, 12)}
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setMergeOpen(false)}>
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-[11px] text-muted-foreground font-mono">
                  {merge.branch} → {merge.baseBranch}
                </div>
                {files.length > 0 && (
                  <div className="text-[11px] text-amber-500">
                    The worktree has uncommitted changes — only committed work is merged.
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Tip content="Combine all of the branch's commits into a single commit on the base branch">
                    <span className="inline-flex">
                      <Switch checked={mergeSquash} onCheckedChange={setMergeSquash} />
                    </span>
                  </Tip>
                  <span className="text-[12px]">Squash into one commit</span>
                </div>
                <Input
                  placeholder={`Merge ${merge.branch}`}
                  value={mergeMsg}
                  onChange={(e) => setMergeMsg(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setMergeOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={mergeMut.isPending}
                    onClick={() =>
                      mergeMut.mutate({
                        projectPath: merge.projectPath,
                        branch: merge.branch,
                        baseBranch: merge.baseBranch,
                        squash: mergeSquash,
                        message: mergeMsg.trim() || undefined
                      })
                    }
                  >
                    {mergeMut.isPending ? 'Merging…' : mergeSquash ? 'Squash & merge' : 'Merge'}
                  </Button>
                </div>
                {mergeMut.error && (
                  <div className="max-h-24 overflow-y-auto text-[11px] text-destructive selectable whitespace-pre-wrap">
                    {mergeMut.error.message}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
