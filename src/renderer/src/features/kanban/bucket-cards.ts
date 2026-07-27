/**
 * Pure card-bucket reconciliation for the Kanban board. Undispatched cards
 * render in their authored column (Backlog / To do); dispatched cards are
 * represented by their live chat in the derived columns (so they are only
 * exposed via byChatId, which powers the "mark done" affordance); cards
 * marked done render in Done regardless of dispatch state.
 */
export interface BucketableCard {
  column: string
  chatId: string | null
  sortOrder: number
}

export interface BoardBuckets<T extends BucketableCard> {
  backlog: T[]
  todo: T[]
  done: T[]
  /** Dispatched cards keyed by their chat id (includes done ones). */
  byChatId: Map<string, T>
}

export function bucketCards<T extends BucketableCard>(cards: T[]): BoardBuckets<T> {
  const buckets: BoardBuckets<T> = { backlog: [], todo: [], done: [], byChatId: new Map() }
  for (const card of cards) {
    if (card.chatId) buckets.byChatId.set(card.chatId, card)
    if (card.column === 'done') buckets.done.push(card)
    else if (!card.chatId) buckets[card.column === 'todo' ? 'todo' : 'backlog'].push(card)
    // dispatched + not done: represented by the chat card in derived columns
  }
  for (const key of ['backlog', 'todo', 'done'] as const) {
    buckets[key].sort((a, b) => a.sortOrder - b.sortOrder)
  }
  return buckets
}

/** Sort order that places a card just before `target` within `column`. */
export function sortOrderBefore<T extends BucketableCard>(column: T[], target: T): number {
  const idx = column.indexOf(target)
  const prev = idx > 0 ? column[idx - 1] : null
  return prev ? (prev.sortOrder + target.sortOrder) / 2 : target.sortOrder - 1
}
