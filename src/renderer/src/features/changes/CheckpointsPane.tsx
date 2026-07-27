/**
 * Checkpoint manager for the Changes view: named working-tree snapshots
 * alongside the automatic per-message rollback checkpoints, A/B compare
 * between any two snapshots (file list + per-file diff), rename/tag,
 * delete, and pruning of keep-alive refs nothing references anymore.
 */
import React, { useState } from 'react'
import { Camera, Check, Pencil, Trash2, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { DiffContent } from './diff-content'

/** A selected snapshot: the effective compare ref is stashSha ?? headSha. */
export interface SnapshotSel {
  id: string
  headSha: string
  stashSha: string | null
}

function fileStatusColor(status: string): string {
  if (status.includes('D')) return 'text-destructive'
  if (status.includes('A')) return 'text-green-500'
  return 'text-amber-500'
}

/** Right-pane diff of one file between two snapshots. */
export function CheckpointDiffPanel({
  chatId,
  a,
  b,
  path
}: {
  chatId: string
  a: SnapshotSel
  b: SnapshotSel
  path: string
}): React.JSX.Element {
  const diff = trpc.checkpoints.compareFile.useQuery({
    chatId,
    a: { headSha: a.headSha, stashSha: a.stashSha },
    b: { headSha: b.headSha, stashSha: b.stashSha },
    path
  })
  return <DiffContent diff={diff.data} isLoading={diff.isLoading} />
}

/** Left-column body: snapshot list, compare file list, composer, prune. */
export function CheckpointsList({
  chatId,
  a,
  b,
  onToggle,
  file,
  onFile
}: {
  chatId: string
  a: SnapshotSel | null
  b: SnapshotSel | null
  onToggle: (sel: SnapshotSel) => void
  file: string | null
  onFile: (path: string | null) => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const list = trpc.checkpoints.list.useQuery({ chatId }, { refetchInterval: 8000 })
  const compare = trpc.checkpoints.compare.useQuery(
    {
      chatId,
      a: { headSha: a?.headSha ?? 'x', stashSha: a?.stashSha ?? null },
      b: { headSha: b?.headSha ?? 'x', stashSha: b?.stashSha ?? null }
    },
    { enabled: !!(a && b) }
  )
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTag, setEditTag] = useState('')
  const [pruned, setPruned] = useState<number | null>(null)

  const invalidate = (): void => {
    utils.checkpoints.list.invalidate({ chatId })
    utils.checkpoints.compare.invalidate()
  }
  const create = trpc.checkpoints.create.useMutation({
    onSuccess: () => {
      setNewName('')
      invalidate()
    }
  })
  const update = trpc.checkpoints.update.useMutation({
    onSuccess: () => {
      setEditingId(null)
      invalidate()
    }
  })
  const remove = trpc.checkpoints.remove.useMutation({ onSuccess: invalidate })
  const prune = trpc.checkpoints.prune.useMutation({ onSuccess: (r) => setPruned(r.deleted) })
  const mutationError = create.error ?? update.error ?? remove.error ?? prune.error

  const entries = list.data ?? []
  const markFor = (id: string): 'A' | 'B' | null => (a?.id === id ? 'A' : b?.id === id ? 'B' : null)

  return (
    <>
      <div className="flex-1 overflow-y-auto p-1">
        {entries.length === 0 && !list.isLoading && (
          <div className="p-4 text-center text-[11px] text-muted-foreground">
            No checkpoints yet — snapshots are captured automatically before each message, or name
            one below.
          </div>
        )}
        {entries.map((e) => {
          const mark = markFor(e.id)
          if (editingId === e.id) {
            return (
              <div key={e.id} className="space-y-1 rounded bg-accent/50 px-2 py-1.5">
                <Input
                  autoFocus
                  placeholder="Name"
                  value={editName}
                  onChange={(ev) => setEditName(ev.target.value)}
                  className="h-6 text-[11px]"
                />
                <Input
                  placeholder="Tag (optional)"
                  value={editTag}
                  onChange={(ev) => setEditTag(ev.target.value)}
                  className="h-6 text-[11px]"
                />
                <div className="flex justify-end gap-1">
                  <Tip content="Cancel editing">
                    <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                      <X size={12} />
                    </Button>
                  </Tip>
                  <Tip content="Save the checkpoint's name and tag">
                    <span className="inline-flex">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={!editName.trim() || update.isPending}
                        onClick={() =>
                          update.mutate({
                            id: e.id,
                            name: editName.trim(),
                            tag: editTag.trim() || null
                          })
                        }
                      >
                        <Check size={12} />
                      </Button>
                    </span>
                  </Tip>
                </div>
              </div>
            )
          }
          return (
            <div
              key={e.id}
              onClick={() => {
                onFile(null)
                onToggle({ id: e.id, headSha: e.headSha, stashSha: e.stashSha })
              }}
              className={cn(
                'group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1',
                mark ? 'bg-accent' : 'hover:bg-accent/50'
              )}
            >
              <span
                className={cn(
                  'w-3 shrink-0 text-center font-mono text-[10px]',
                  mark ? 'text-primary' : 'text-transparent'
                )}
              >
                {mark ?? '·'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-[11px]" title={e.name ?? undefined}>
                    {e.name ?? 'Auto checkpoint'}
                  </span>
                  {e.tag && (
                    <span className="shrink-0 rounded bg-primary/15 px-1 font-mono text-[9px] text-primary">
                      {e.tag}
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {(e.stashSha ?? e.headSha).slice(0, 7)} · {e.source} · {timeAgo(e.createdAt)}
                </div>
              </div>
              {e.source === 'manual' && (
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <Tip content="Rename this checkpoint or set a tag">
                    <button
                      className="cursor-pointer text-muted-foreground hover:text-foreground"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        setEditingId(e.id)
                        setEditName(e.name ?? '')
                        setEditTag(e.tag ?? '')
                      }}
                    >
                      <Pencil size={11} />
                    </button>
                  </Tip>
                  <Tip content="Delete this named checkpoint (auto message checkpoints are unaffected)">
                    <button
                      className="cursor-pointer text-muted-foreground hover:text-destructive"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        void confirmDialog({
                          title: 'Delete checkpoint?',
                          description: `"${e.name}" will be removed. Its snapshot is freed unless something else still references it.`,
                          confirmLabel: 'Delete'
                        }).then((ok) => {
                          if (ok) remove.mutate({ chatId, id: e.id })
                        })
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </Tip>
                </span>
              )}
            </div>
          )
        })}
      </div>
      {a && b && (
        <div className="max-h-48 shrink-0 overflow-y-auto border-t border-border p-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            A → B differences
          </div>
          {(compare.data ?? []).length === 0 && !compare.isLoading && (
            <div className="px-2 pb-1 text-[11px] text-muted-foreground">No differences</div>
          )}
          {compare.error && (
            <div className="selectable px-2 pb-1 text-[11px] text-destructive">
              {compare.error.message}
            </div>
          )}
          {(compare.data ?? []).map((f) => (
            <div
              key={f.path}
              onClick={() => onFile(f.path)}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5',
                file === f.path ? 'bg-accent' : 'hover:bg-accent/50'
              )}
            >
              <span className={cn('w-3 font-mono text-[10px]', fileStatusColor(f.status))}>
                {f.status}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{f.path}</span>
            </div>
          ))}
        </div>
      )}
      {!(a && b) && entries.length > 1 && (
        <div className="shrink-0 border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
          Select two checkpoints to compare them.
        </div>
      )}
      <div className="shrink-0 space-y-2 border-t border-border p-2">
        <div className="flex gap-2">
          <Input
            placeholder="Checkpoint name"
            value={newName}
            onChange={(ev) => setNewName(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && newName.trim() && !create.isPending) {
                create.mutate({ chatId, name: newName.trim() })
              }
            }}
            className="h-7 flex-1 text-[11px]"
          />
          <Tip content="Snapshot the working tree right now as a named checkpoint">
            <span className="inline-flex">
              <Button
                size="sm"
                disabled={!newName.trim() || create.isPending}
                onClick={() => create.mutate({ chatId, name: newName.trim() })}
              >
                <Camera size={13} />
              </Button>
            </span>
          </Tip>
          <Tip content="Delete snapshot refs nothing references anymore (no message rollback and no named checkpoint, project-wide)">
            <span className="inline-flex">
              <Button
                size="sm"
                variant="secondary"
                disabled={prune.isPending}
                onClick={() => {
                  setPruned(null)
                  void confirmDialog({
                    title: 'Prune checkpoint refs?',
                    description:
                      'Snapshots no message rollback or named checkpoint references anymore are deleted from the repo.',
                    confirmLabel: 'Prune'
                  }).then((ok) => {
                    if (ok) prune.mutate({ chatId })
                  })
                }}
              >
                Prune
              </Button>
            </span>
          </Tip>
        </div>
        {pruned !== null && (
          <div className="text-[11px] text-muted-foreground">
            Pruned {pruned} unreferenced snapshot{pruned === 1 ? '' : 's'}.
          </div>
        )}
        {mutationError && (
          <div className="selectable text-[11px] text-destructive">{mutationError.message}</div>
        )}
      </div>
    </>
  )
}
