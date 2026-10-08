/**
 * Dismissable list of prompts queued behind the active run, rendered above
 * the composer. Items live in the main process and are sent one at a time,
 * in order, as each run finishes; rows can be drag-reordered, copied,
 * dismissed, and — for plain prompts — edited inline before they send.
 */
import React, { useState } from 'react'
import { Check, Copy, GripVertical, Pencil } from 'lucide-react'
import type { QueuedPromptInfo } from '../../../../shared/ui-message'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'

const DRAG_TYPE = 'application/x-yardarm-queued-prompt'

export function QueuedPrompts({
  items,
  onDismiss,
  onReorder,
  onEdit
}: {
  items: QueuedPromptInfo[]
  onDismiss: (id: string) => void
  onReorder: (id: string, beforeId?: string) => void
  onEdit: (id: string, text: string) => void
}): React.JSX.Element | null {
  const [dragOverId, setDragOverId] = useState<string | 'end' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
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
  const copyItem = (item: QueuedPromptInfo): void => {
    void navigator.clipboard.writeText(item.text)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 1500)
  }
  const saveEdit = (id: string): void => {
    const text = draft.trim()
    if (text) onEdit(id, text)
    setEditingId(null)
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
            draggable={editingId !== item.id}
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
              'flex items-center gap-2 rounded border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs',
              editingId !== item.id && 'cursor-grab active:cursor-grabbing',
              dragOverId === item.id && 'border-t-2 border-t-sky-500'
            )}
          >
            <GripVertical size={12} className="shrink-0 opacity-40" />
            {editingId === item.id ? (
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <textarea
                  autoFocus
                  rows={Math.min(6, Math.max(2, draft.split('\n').length))}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      saveEdit(item.id)
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingId(null)
                    }
                  }}
                  className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex gap-2 text-[11px]">
                  <Tip content="Save the edited message (Enter)">
                    <button
                      className="cursor-pointer rounded border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-50"
                      disabled={!draft.trim()}
                      onClick={() => saveEdit(item.id)}
                    >
                      Save
                    </button>
                  </Tip>
                  <Tip content="Discard changes (Esc)">
                    <button
                      className="cursor-pointer rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </Tip>
                </div>
              </div>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate" title={item.text}>
                  {item.text}
                </span>
                {item.fileCount > 0 && (
                  <span className="shrink-0 text-muted-foreground">
                    {item.fileCount} file{item.fileCount === 1 ? '' : 's'}
                  </span>
                )}
                <Tip content="Copy this queued message's text">
                  <button
                    className="shrink-0 cursor-pointer opacity-70 hover:opacity-100"
                    onClick={() => copyItem(item)}
                  >
                    {copiedId === item.id ? (
                      <Check size={12} className="text-green-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </Tip>
                {item.editable && (
                  <Tip content="Edit this queued message before it sends">
                    <button
                      className="shrink-0 cursor-pointer opacity-70 hover:opacity-100"
                      onClick={() => {
                        setDraft(item.text)
                        setEditingId(item.id)
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                  </Tip>
                )}
                <Tip content="Remove this queued message — it won't be sent">
                  <button
                    className="shrink-0 cursor-pointer opacity-70 hover:opacity-100"
                    onClick={() => onDismiss(item.id)}
                  >
                    ×
                  </button>
                </Tip>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
