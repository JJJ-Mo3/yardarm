/**
 * Details-panel widget: uncommitted changes in the chat's worktree, polled
 * while the panel is open. Clicking a file opens it in the Files tab (via
 * fileOpenRequestAtom); deleted files are shown but not clickable.
 */
import React from 'react'
import { useSetAtom } from 'jotai'
import { FileText } from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { fileOpenRequestAtom, mainTabAtom } from '../../../lib/atoms'
import { Tip } from '../../../components/ui/tooltip'

/** Human label + color class for a two-char porcelain XY status. */
function statusBadge(status: string): { label: string; className: string } {
  const s = status.trim()
  if (s === '??' || s.includes('A')) return { label: 'A', className: 'text-emerald-500' }
  if (s.includes('D')) return { label: 'D', className: 'text-red-500' }
  if (s.includes('R')) return { label: 'R', className: 'text-sky-500' }
  return { label: 'M', className: 'text-amber-500' }
}

export function ChangedFilesWidget({ cwd }: { cwd: string | null }): React.JSX.Element {
  const setMainTab = useSetAtom(mainTabAtom)
  const setFileOpenRequest = useSetAtom(fileOpenRequestAtom)
  const status = trpc.git.status.useQuery(
    { cwd: cwd ?? '' },
    { enabled: !!cwd, refetchInterval: 5000, retry: false }
  )

  const files = status.data?.files ?? []
  return (
    <div className="space-y-1">
      {!cwd && <div className="text-[11px] text-muted-foreground">No worktree for this chat.</div>}
      {cwd && status.error && (
        <div className="text-[11px] text-muted-foreground selectable">{status.error.message}</div>
      )}
      {cwd && status.data && files.length === 0 && (
        <div className="text-[11px] text-muted-foreground">No uncommitted changes.</div>
      )}
      {files.map((f) => {
        const badge = statusBadge(f.status)
        const deleted = badge.label === 'D'
        return (
          <Tip
            key={f.path}
            content={deleted ? `${f.path} (deleted)` : `Open ${f.path} in the Files tab`}
          >
            <span className="flex w-full">
              <button
                disabled={deleted}
                onClick={() => {
                  setFileOpenRequest(f.path)
                  setMainTab('files')
                }}
                className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-accent disabled:cursor-default disabled:opacity-60 cursor-pointer"
              >
                <FileText size={11} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={f.path}>
                  {f.path}
                </span>
                <span className={`shrink-0 font-mono text-[10px] ${badge.className}`}>
                  {badge.label}
                </span>
              </button>
            </span>
          </Tip>
        )
      })}
      {status.data && (
        <div className="pt-0.5 text-[10px] text-muted-foreground">
          {status.data.branch}
          {status.data.ahead > 0 ? ` · ${status.data.ahead} ahead` : ''}
          {status.data.behind > 0 ? ` · ${status.data.behind} behind` : ''}
        </div>
      )}
    </div>
  )
}
