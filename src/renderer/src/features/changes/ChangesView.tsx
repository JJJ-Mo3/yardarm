import React, { useMemo, useState } from 'react'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import { generateDiffFile } from '@git-diff-view/file'
import { GitCommitHorizontal, Minus, Plus, RefreshCw, Undo2, Upload } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'

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
  const status = trpc.git.status.useQuery({ cwd }, { refetchInterval: 4000 })
  const [selected, setSelected] = useState<string | null>(null)
  const [commitMsg, setCommitMsg] = useState('')

  const invalidate = (): void => {
    utils.git.status.invalidate({ cwd })
    utils.git.fileDiff.invalidate()
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

  const files = status.data?.files ?? []

  return (
    <div className="flex h-full">
      {/* File list + commit box */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="truncate font-mono text-[11px] text-muted-foreground flex-1">
            {status.data?.branch ?? ''}
            {status.data && status.data.ahead > 0 ? ` ↑${status.data.ahead}` : ''}
          </span>
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
                    if (confirm(`Discard changes to ${f.path}?`)) {
                      discard.mutate({ cwd, paths: [f.path] })
                    }
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
          {(commit.error || push.error) && (
            <div className="text-[11px] text-destructive selectable">
              {commit.error?.message ?? push.error?.message}
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
    </div>
  )
}
