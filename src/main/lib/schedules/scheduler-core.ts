/**
 * Pure decision helpers for the schedule runner, kept side-effect free so the
 * due/skip/target logic is unit-testable without Electron or the database.
 */

/** Whether a schedule row should fire on this tick (enabled + due). */
export function isDue(row: { enabled: boolean; nextRunAt: number | null }, now: number): boolean {
  return row.enabled && row.nextRunAt !== null && row.nextRunAt <= now
}

/**
 * Overlap policy: a busy target chat (active run or queued prompts) skips the
 * occurrence entirely — queueing a recurring prompt behind a long run would
 * replay it N times when the run ends.
 */
export function shouldSkip(running: boolean, queuedCount: number): boolean {
  return running || queuedCount > 0
}

/** Archived (or deleted) target chats are treated as missing and recreated. */
export function chatUsable(chat: { archived: boolean } | undefined): boolean {
  return chat !== undefined && !chat.archived
}
