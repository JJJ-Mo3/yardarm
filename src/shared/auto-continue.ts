/**
 * Tasks auto-continue: opt-in behavior that keeps long task lists moving.
 * When a run ends normally ('complete') but the agent's task list still has
 * unfinished items — and nothing is waiting on the user — the session manager
 * sends a hidden continue prompt instead of making the user queue "continue"
 * messages by hand. Pure helpers shared across processes; the session manager
 * resolves the effective per-chat value (subchat override falling back to the
 * global app_settings default) and enforces the budget/progress guards.
 */

import type { TaskItem } from './ui-message'

/**
 * Hard cap on auto-continue rounds per user prompt, so a confused model can
 * never loop forever. Each real user send re-arms the budget.
 */
export const AUTO_CONTINUE_MAX_ROUNDS = 25

/**
 * Effective auto-continue value for a session: the per-subchat override wins
 * when set; otherwise the global default applies (absent/undefined = off —
 * this feature is opt-in).
 */
export function resolveAutoContinue(
  subchatValue: boolean | null | undefined,
  globalValue: unknown
): boolean {
  if (typeof subchatValue === 'boolean') return subchatValue
  return globalValue === true
}

/** Tasks that still need work: anything not completed or cancelled. */
export function countUnfinishedTasks(tasks: TaskItem[]): number {
  return tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length
}

/**
 * Stable fingerprint of the task list's identities + statuses, used to detect
 * a round that made no progress (same fingerprint after a full run = stop).
 */
export function tasksFingerprint(tasks: TaskItem[]): string {
  return JSON.stringify(tasks.map((t) => [t.id ?? t.content ?? '', t.status ?? '']))
}

/**
 * Hidden continue prompt. The `<system-reminder>` wrapper makes the SDK
 * filter it from later recalls, so no fake user turn pollutes agent memory —
 * the transcript record is the session manager's info marker.
 */
export function buildTasksContinuePrompt(remaining: number): string {
  return (
    '<system-reminder>\nThe previous run ended, but the task list still has ' +
    `${remaining} unfinished task${remaining === 1 ? '' : 's'}. Continue working through ` +
    'the remaining tasks from where you left off. If a task cannot be completed or ' +
    'genuinely needs the user, say so explicitly instead of stopping silently.\n' +
    '</system-reminder>'
  )
}
