/**
 * Dismissable list of prompts queued behind the active run, rendered above
 * the composer. Items live in the main process and are sent one at a time,
 * in order, as each run finishes; dismissing removes an item before it sends,
 * and rows can be drag-reordered to change the send order.
 */
import React, { useState } from 'react'
import { GripVertical } from 'lucide-react'
import type { QueuedPromptInfo } from '../../../../shared/ui-message'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'

const DRAG_TYPE = 'application/x-yardarm-queued-prompt'

export function QueuedPrompts({
  items,
  onDismiss,
  onReorder
}: {
  items: QueuedPromptInfo[]
  onDismiss: (id: string) => void
  onReorder: (id: string, beforeId?: string) => void
}): React.JSX.Element | null {
  const [dragOverId, setDragOverId] = useState<string | 'end' | null>(null)
  if (items.length === 0) return null

  const allowDrop = (e: React.DragEvent, over: string | 'end'): void => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    setDragOverId(over)
  }
  const drop = (e: React.DragEvent, beforeId?: string): void => {
    const id = e.dataTransfer.getData(DRAG_TYPE)
    setDragOverId(null)
    if (!id || id === beforeId) return
    e.preventDefault()
    e.stopPropagation()
    onReorder(id, beforeId)
  }

  return (
    <div className="px-4 pb-2">
      <div className="mb-1 text-[11px] text-muted-foreground">
        {items.length} queued — sent in order when the current run finishes; drag to reorder
      </div>
      <div
        className={cn(
          'space-y-1 rounded',
          dragOverId === 'end' && 'outline-1 outline-dashed outline-sky-500/50'
        )}
        onDragOver={(e) => allowDrop(e, 'end')}
        onDragLeave={() => setDragOverId(null)}
        onDrop={(e) => drop(e)}
      >
        {items.map((item) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, item.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              e.stopPropagation()
              allowDrop(e, item.id)
            }}
            onDragLeave={() => setDragOverId(null)}
            onDrop={(e) => drop(e, item.id)}
            className={cn(
              'flex cursor-grab items-center gap-2 rounded border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs active:cursor-grabbing',
              dragOverId === item.id && 'border-t-2 border-t-sky-500'
            )}
          >
            <GripVertical size={12} className="shrink-0 opacity-40" />
            <span className="min-w-0 flex-1 truncate" title={item.text}>
              {item.text}
            </span>
            {item.fileCount > 0 && (
              <span className="shrink-0 text-muted-foreground">
                {item.fileCount} file{item.fileCount === 1 ? '' : 's'}
              </span>
            )}
            <Tip content="Remove this queued message — it won't be sent">
              <button
                className="shrink-0 cursor-pointer opacity-70 hover:opacity-100"
                onClick={() => onDismiss(item.id)}
              >
                ×
              </button>
            </Tip>
          </div>
        ))}
      </div>
    </div>
  )
}
