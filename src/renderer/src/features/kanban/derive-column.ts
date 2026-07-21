/**
 * Pure column-derivation for the Kanban board. Columns are derived from live
 * agent status (never persisted): a chat sits in exactly one column, with
 * awaiting-input outranking running outranking unseen-finished.
 */
export type KanbanColumnId = 'needs-input' | 'in-progress' | 'ready' | 'idle'

export interface KanbanSignals {
  archived: boolean
  running: boolean
  awaiting: boolean
  unseen: boolean
}

/** null = hidden from the board (archived chats, matching the Sidebar). */
export function deriveKanbanColumn(s: KanbanSignals): KanbanColumnId | null {
  if (s.archived) return null
  if (s.awaiting) return 'needs-input'
  if (s.running) return 'in-progress'
  if (s.unseen) return 'ready'
  return 'idle'
}

export const KANBAN_COLUMNS: Array<{
  id: KanbanColumnId
  label: string
  dotClass: string
  empty: string
}> = [
  {
    id: 'needs-input',
    label: 'Needs input',
    dotClass: 'bg-amber-500',
    empty: 'No chats waiting on you'
  },
  {
    id: 'in-progress',
    label: 'In progress',
    dotClass: 'bg-emerald-500 animate-pulse',
    empty: 'No agents running'
  },
  {
    id: 'ready',
    label: 'Ready to review',
    dotClass: 'bg-blue-500',
    empty: 'Nothing finished unseen'
  },
  {
    id: 'idle',
    label: 'Idle',
    dotClass: 'bg-muted-foreground',
    empty: 'No idle chats'
  }
]
