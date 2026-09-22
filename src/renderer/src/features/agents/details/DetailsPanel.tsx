/**
 * Right-hand details side panel for the primary chat pane: uncommitted
 * worktree changes, the agent's live task list, and the latest submitted
 * plan. Width is drag-resizable (clamped 240–480px) and persisted.
 */
import React, { useRef } from 'react'
import { useAtom } from 'jotai'
import { FileDiff, ListTodo, ScrollText, X } from 'lucide-react'
import { detailsWidthAtom } from '../../../lib/atoms'
import { Tip } from '../../../components/ui/tooltip'
import { ChangedFilesWidget } from './ChangedFilesWidget'
import { TasksWidget } from './TasksWidget'
import { PlanWidget } from './PlanWidget'
import type { StoredMessage, TaskItem } from '../../../../../shared/ui-message'

const MIN_WIDTH = 240
const MAX_WIDTH = 480

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

export function DetailsPanel({
  cwd,
  tasks,
  messages,
  onClose
}: {
  cwd: string | null
  tasks: TaskItem[]
  messages: StoredMessage[]
  onClose: () => void
}): React.JSX.Element {
  const [width, setWidth] = useAtom(detailsWidthAtom)
  const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent): void => {
    dragState.current = { startX: e.clientX, startWidth: clamped }
    const move = (ev: PointerEvent): void => {
      const drag = dragState.current
      if (!drag) return
      setWidth(
        Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.startWidth + (drag.startX - ev.clientX)))
      )
    }
    const up = (): void => {
      dragState.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      style={{ width: clamped }}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-card/50"
    >
      {/* Drag handle on the panel's left edge. */}
      <div
        onPointerDown={onPointerDown}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
      />
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium">Details</span>
        <Tip content="Close the details panel">
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X size={13} />
          </button>
        </Tip>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <Section icon={<FileDiff size={11} />} title="Changed files">
          <ChangedFilesWidget cwd={cwd} />
        </Section>
        <Section icon={<ListTodo size={11} />} title="Tasks">
          <TasksWidget tasks={tasks} />
        </Section>
        <Section icon={<ScrollText size={11} />} title="Plan">
          <PlanWidget messages={messages} />
        </Section>
      </div>
    </div>
  )
}
