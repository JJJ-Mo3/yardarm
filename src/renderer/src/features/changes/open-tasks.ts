/**
 * Unfinished-tasks warning for the merge and create-PR flows: a one-line,
 * non-blocking reminder when the chat's agent task list still has open items.
 * Pure.
 */
import type { TaskItem } from '../../../../shared/ui-message'

const CLOSED_STATUSES = new Set(['completed', 'cancelled', 'canceled'])

/** Tasks the agent has not finished (pending or in progress). */
export function openTasks(tasks: TaskItem[]): TaskItem[] {
  return tasks.filter((t) => !CLOSED_STATUSES.has(t.status ?? ''))
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * "3 tasks are still open: A; B; C" — null when nothing is open. Lists at
 * most `maxListed` task titles and counts the rest.
 */
export function openTasksWarning(tasks: TaskItem[], maxListed = 3): string | null {
  const open = openTasks(tasks)
  if (open.length === 0) return null
  const head = open.length === 1 ? '1 task is still open' : `${open.length} tasks are still open`
  const titles = open
    .map((t) => shorten(t.content ?? '', 60))
    .filter(Boolean)
    .slice(0, maxListed)
  if (titles.length === 0) return `${head}.`
  const rest = open.length - titles.length
  return `${head}: ${titles.join('; ')}${rest > 0 ? `; and ${rest} more` : ''}`
}
