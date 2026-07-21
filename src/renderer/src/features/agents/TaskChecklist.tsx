/**
 * Collapsible checklist strip for the agent's plan task list, rendered
 * between the chat header and the transcript. Labeled "Tasks n/m" with a
 * chevron toggle; visibility is derived rather than cleared — the strip
 * hides once every task is completed and the run has ended (so a replayed
 * fully-completed checklist from a reopened chat stays hidden), but keeps
 * showing unfinished tasks when a run ends early.
 */
import React, { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, CircleDot, ListTodo } from 'lucide-react'
import { Tip } from '../../components/ui/tooltip'
import type { TaskItem } from '../../../../shared/ui-message'

export function TaskChecklist({
  tasks,
  running
}: {
  tasks: TaskItem[]
  running: boolean
}): React.JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false)
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'completed').length
  if (total === 0 || (done === total && !running)) return null
  return (
    <div className="border-b border-border">
      <Tip content={collapsed ? 'Show the agent task checklist' : 'Hide the agent task checklist'}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-1.5 px-4 py-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          <ListTodo size={11} />
          <span className="font-medium">Tasks</span>
          <span>
            {done}/{total}
          </span>
        </button>
      </Tip>
      {!collapsed && (
        <div className="px-4 pb-2 space-y-0.5 max-h-32 overflow-y-auto">
          {tasks.map((t, i) => (
            <div key={t.id ?? i} className="flex items-center gap-1.5 text-[11px]">
              {t.status === 'completed' ? (
                <CheckCircle2 size={11} className="text-green-500 shrink-0" />
              ) : t.status === 'in_progress' ? (
                <CircleDot size={11} className="text-blue-400 shrink-0" />
              ) : (
                <Circle size={11} className="text-muted-foreground shrink-0" />
              )}
              <span
                className={t.status === 'completed' ? 'text-muted-foreground line-through' : ''}
              >
                {t.content ?? ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
