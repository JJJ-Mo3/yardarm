/**
 * Details-panel widget: the agent's live plan task list (same data as the
 * TaskChecklist strip, rendered in full without the collapse affordance).
 */
import React from 'react'
import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import type { TaskItem } from '../../../../../shared/ui-message'

export function TasksWidget({ tasks }: { tasks: TaskItem[] }): React.JSX.Element {
  if (tasks.length === 0) {
    return <div className="text-[11px] text-muted-foreground">No tasks in the current plan.</div>
  }
  return (
    <div className="space-y-0.5">
      {tasks.map((t, i) => (
        <div key={t.id ?? i} className="flex items-start gap-1.5 text-[11px]">
          {t.status === 'completed' ? (
            <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-green-500" />
          ) : t.status === 'in_progress' ? (
            <CircleDot size={11} className="mt-0.5 shrink-0 text-blue-400" />
          ) : (
            <Circle size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <span className={t.status === 'completed' ? 'text-muted-foreground line-through' : ''}>
            {t.content ?? ''}
          </span>
        </div>
      ))}
    </div>
  )
}
