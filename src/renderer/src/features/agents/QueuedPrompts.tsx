/**
 * Dismissable list of prompts queued behind the active run, rendered above
 * the composer. Items live in the main process and are sent one at a time,
 * in order, as each run finishes; dismissing removes an item before it sends.
 */
import React from 'react'
import type { QueuedPromptInfo } from '../../../../shared/ui-message'
import { Tip } from '../../components/ui/tooltip'

export function QueuedPrompts({
  items,
  onDismiss
}: {
  items: QueuedPromptInfo[]
  onDismiss: (id: string) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="px-4 pb-2">
      <div className="mb-1 text-[11px] text-muted-foreground">
        {items.length} queued — sent in order when the current run finishes
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-xs"
          >
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
