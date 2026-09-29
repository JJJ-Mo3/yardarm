/**
 * Kanban over a Factory project's server-defined board: columns are the
 * board's phases (tinted by kind), cards are work items placed by their
 * current stage. Drags are only accepted by a card's legal transition targets
 * (the current phase's declared edges); drops POST a transition with the
 * card's revision, so a 409 [stale] just refreshes. Cards in a working phase
 * can start an agent run with that phase's role.
 */
import React, { useMemo, useState } from 'react'
import { Play, Plus, X } from 'lucide-react'
import type { FactoryBoard, FactoryWorkItem } from '@shared/factory-work-types'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Tip } from '../../components/ui/tooltip'
import { factoryErrorCode } from './FactoryWorkPanel'

const DRAG_TYPE = 'text/yardarm-factory-card'

const KIND_DOT: Record<string, string> = {
  resting: 'bg-muted-foreground/50',
  working: 'bg-violet-500',
  terminal: 'bg-green-500'
}

/** The item's current phase id on `board`, or null when none match. */
function stageOn(item: FactoryWorkItem, phaseIds: Set<string>): string | null {
  for (const stage of item.stages ?? []) {
    if (phaseIds.has(stage)) return stage
  }
  return null
}

function itemAge(item: FactoryWorkItem): string | null {
  const ts = item.updatedAt ? Date.parse(item.updatedAt) : NaN
  return Number.isFinite(ts) ? timeAgo(ts) : null
}

export function FactoryWorkBoard({
  dir,
  projectId,
  active
}: {
  dir: string
  projectId: string
  active: boolean
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const boards = trpc.factoryWork.boards.useQuery(
    { dir, projectId },
    { enabled: active, refetchInterval: active ? 30_000 : false, retry: false }
  )
  const work = trpc.factoryWork.workItems.useQuery(
    { dir, projectId },
    { enabled: active, refetchInterval: active ? 4000 : false, retry: false }
  )

  const [boardId, setBoardId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const boardList = boards.data ?? []
  const board: FactoryBoard | null = boardList.find((b) => b.id === boardId) ?? boardList[0] ?? null

  const invalidate = (): void => {
    void utils.factoryWork.workItems.invalidate({ dir, projectId })
  }

  const onApiError = (message: string): void => {
    const code = factoryErrorCode(message)
    if (code === 'stale') {
      invalidate()
      setNotice('Board changed underneath you — refreshed.')
    } else if (code === 'governed_transition_required') {
      setNotice('A decision gate owns that transition — resolve it from the Decisions tab.')
    } else if (code === 'http_503') {
      setNotice('This Factory server has no run coordinator — runs can’t be started from here.')
    } else {
      setNotice(message)
    }
  }

  const transition = trpc.factoryWork.transition.useMutation({
    onSuccess: invalidate,
    onError: (err) => onApiError(err.message)
  })
  const createItem = trpc.factoryWork.createWorkItem.useMutation({
    onSuccess: () => {
      setNewTitle('')
      setComposing(false)
      invalidate()
    },
    onError: (err) => onApiError(err.message)
  })
  const startRun = trpc.factoryWork.startRun.useMutation({
    onSuccess: invalidate,
    onError: (err) => onApiError(err.message)
  })

  const phaseIds = useMemo(() => new Set((board?.phases ?? []).map((p) => p.id)), [board])
  const items = useMemo(() => work.data?.workItems ?? [], [work.data])
  const running = useMemo(() => new Set(work.data?.runningSessionIds ?? []), [work.data])

  const byPhase = useMemo(() => {
    const map = new Map<string, FactoryWorkItem[]>()
    if (!board) return map
    for (const phase of board.phases) map.set(phase.id, [])
    for (const item of items) {
      const stage = stageOn(item, phaseIds)
      if (stage) map.get(stage)!.push(item)
      else if (item.board === board.id) map.get(board.initialPhase)?.push(item)
    }
    return map
  }, [board, items, phaseIds])

  /** Legal drop targets for the card currently being dragged. */
  const dragTargets = useMemo(() => {
    if (!board || !draggingId) return new Set<string>()
    const item = items.find((i) => i.id === draggingId)
    if (!item) return new Set<string>()
    const stage = stageOn(item, phaseIds) ?? board.initialPhase
    const phase = board.phases.find((p) => p.id === stage)
    return new Set((phase?.transitions ?? []).map((t) => t.to).filter((to) => to !== stage))
  }, [board, draggingId, items, phaseIds])

  const isRunning = (item: FactoryWorkItem): boolean =>
    Object.values(item.sessions ?? {}).some((s) => s?.sessionId && running.has(s.sessionId))

  if (boards.error || work.error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {(boards.error ?? work.error)?.message}
      </div>
    )
  }
  if (!board) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {boards.isLoading ? 'Loading board…' : 'This project has no boards.'}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        {boardList.length > 1 && (
          <Select value={board.id} onValueChange={setBoardId}>
            <Tip content="Which of this project's boards to show" side="bottom">
              <SelectTrigger className="h-6 text-[11px]">
                <SelectValue />
              </SelectTrigger>
            </Tip>
            <SelectContent>
              {boardList.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {notice && (
          <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
            <span className="selectable truncate">{notice}</span>
            <Tip content="Dismiss this notice">
              <button
                className="cursor-pointer hover:text-foreground"
                onClick={() => setNotice(null)}
              >
                <X size={11} />
              </button>
            </Tip>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {board.phases.map((phase) => {
          const rows = byPhase.get(phase.id) ?? []
          const droppable = dragTargets.has(phase.id)
          const isInitial = phase.id === board.initialPhase
          return (
            <div
              key={phase.id}
              className={cn(
                'flex h-full w-64 shrink-0 flex-col rounded-lg border bg-card',
                droppable ? 'border-ring' : 'border-border',
                draggingId && !droppable && 'opacity-60'
              )}
              onDragOver={(e) => {
                if (droppable && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault()
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(DRAG_TYPE)
                if (!id || !droppable) return
                e.preventDefault()
                const item = items.find((i) => i.id === id)
                if (!item) return
                transition.mutate({
                  dir,
                  projectId,
                  workItemId: item.id,
                  board: board.id,
                  stage: phase.id,
                  expectedRevision: item.revision
                })
              }}
            >
              <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    KIND_DOT[phase.kind] ?? 'bg-muted-foreground/50'
                  )}
                />
                <span className="truncate text-xs font-medium">{phase.title}</span>
                {phase.role && <Badge className="text-[10px]">{phase.role}</Badge>}
                <Badge className="ml-auto">{rows.length}</Badge>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
                {rows.map((item) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, item.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setDraggingId(item.id)
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    className="group cursor-grab rounded-md border border-border bg-background px-2.5 py-2"
                  >
                    <div className="flex items-center gap-1.5">
                      {isRunning(item) && (
                        <Tip content="An agent run is active on this card">
                          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                        </Tip>
                      )}
                      <div className="min-w-0 flex-1 truncate text-[13px]">{item.title}</div>
                      {phase.kind !== 'terminal' && (
                        <Tip
                          content={`Start an agent run on this card (role: ${phase.role ?? 'work'})`}
                        >
                          <span className="hidden shrink-0 group-hover:inline-flex">
                            <button
                              className="cursor-pointer text-muted-foreground hover:text-foreground disabled:opacity-50"
                              disabled={startRun.isPending}
                              onClick={() =>
                                startRun.mutate({
                                  dir,
                                  projectId,
                                  workItemId: item.id,
                                  role: phase.role ?? 'work'
                                })
                              }
                            >
                              <Play size={11} />
                            </button>
                          </span>
                        </Tip>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                      {item.externalSource?.type && (
                        <span className="rounded bg-accent px-1">{item.externalSource.type}</span>
                      )}
                      {typeof item.commentCount === 'number' && item.commentCount > 0 && (
                        <span>{item.commentCount} 💬</span>
                      )}
                      {itemAge(item) && <span>{itemAge(item)}</span>}
                    </div>
                  </div>
                ))}
                {rows.length === 0 && (
                  <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                    {draggingId && droppable ? 'Drop here' : 'Empty'}
                  </div>
                )}
              </div>
              {isInitial && (
                <div className="shrink-0 border-t border-border p-1.5">
                  {composing ? (
                    <div className="space-y-1.5 p-0.5">
                      <Input
                        autoFocus
                        placeholder="Card title"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newTitle.trim() && !createItem.isPending) {
                            createItem.mutate({
                              dir,
                              projectId,
                              title: newTitle.trim(),
                              board: board.id
                            })
                          }
                        }}
                        className="h-7 text-[12px]"
                      />
                      <div className="flex justify-end gap-1">
                        <Tip content="Close the card composer">
                          <Button size="icon" variant="ghost" onClick={() => setComposing(false)}>
                            <X size={12} />
                          </Button>
                        </Tip>
                        <Tip content="Create this work item — it enters the board's initial phase">
                          <span className="inline-flex">
                            <Button
                              size="sm"
                              disabled={!newTitle.trim() || createItem.isPending}
                              onClick={() =>
                                createItem.mutate({
                                  dir,
                                  projectId,
                                  title: newTitle.trim(),
                                  board: board.id
                                })
                              }
                            >
                              Add
                            </Button>
                          </span>
                        </Tip>
                      </div>
                    </div>
                  ) : (
                    <Tip content="Create a work item in this board's initial phase">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                        onClick={() => setComposing(true)}
                      >
                        <Plus size={13} />
                        New card
                      </Button>
                    </Tip>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
