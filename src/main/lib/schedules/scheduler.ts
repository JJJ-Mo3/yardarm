/**
 * App-managed scheduled runs: a coarse timer fires due `schedules` rows into
 * their (lazily created) fixed target chats as marked prompts. Runs only
 * while the app is open — an overdue schedule fires once on the next tick
 * and re-anchors to now (no burst replay of missed occurrences), and
 * next_run_at advances BEFORE the send so a crash mid-fire can't double-run
 * the same slot. Busy targets skip the occurrence (status 'skipped').
 */
import { asc, eq } from 'drizzle-orm'
import { computeNextRunAt, parseCadence } from '@shared/schedules'
import { getDb, schema } from '../db'
import { agentSessionManager } from '../agent/agent-session-manager'
import { createChatWithSubchat } from '../agent/chat-factory'
import { notifyAgentEvent } from '../notifications'
import { isDue, shouldSkip, chatUsable } from './scheduler-core'

type ScheduleRow = typeof schema.schedules.$inferSelect

const TICK_MS = 60_000
const BOOT_DELAY_MS = 10_000

/** Record a fire attempt (dispatch time + outcome). */
function setLastRun(id: string, status: 'ok' | 'error' | 'skipped'): void {
  const now = Date.now()
  getDb()
    .update(schema.schedules)
    .set({ lastRunAt: now, lastRunStatus: status, updatedAt: now })
    .where(eq(schema.schedules.id, id))
    .run()
}

/** Flip only the outcome (e.g. a dispatched run later errored). */
function setLastRunStatus(id: string, status: 'ok' | 'error' | 'skipped'): void {
  getDb()
    .update(schema.schedules)
    .set({ lastRunStatus: status, updatedAt: Date.now() })
    .where(eq(schema.schedules.id, id))
    .run()
}

/**
 * Resolve the schedule's fixed target chat + earliest subchat, creating a
 * fresh chat when the stored one is gone or archived (chat_id is SET NULL on
 * delete, so both paths land here).
 */
async function resolveTarget(row: ScheduleRow): Promise<{ chatId: string; subchatId: string }> {
  const db = getDb()
  if (row.chatId) {
    const chat = db.select().from(schema.chats).where(eq(schema.chats.id, row.chatId)).get()
    if (chatUsable(chat)) {
      const subchat = db
        .select()
        .from(schema.subchats)
        .where(eq(schema.subchats.chatId, row.chatId))
        .orderBy(asc(schema.subchats.createdAt))
        .get()
      if (subchat) return { chatId: row.chatId, subchatId: subchat.id }
    }
  }
  const created = await createChatWithSubchat({
    projectId: row.projectId,
    title: `Schedule: ${row.name}`,
    useWorktree: row.useWorktree
  })
  db.update(schema.schedules)
    .set({ chatId: created.id, updatedAt: Date.now() })
    .where(eq(schema.schedules.id, row.id))
    .run()
  return { chatId: created.id, subchatId: created.subchats[0].id }
}

/** Run a playbook-mode schedule: workflowRun awaits completion, so outcome
 * bookkeeping is direct — no run-finished listener is needed. */
async function firePlaybook(row: ScheduleRow, chatId: string, subchatId: string): Promise<void> {
  const db = getDb()
  const pb = row.playbookId
    ? db.select().from(schema.playbooks).where(eq(schema.playbooks.id, row.playbookId)).get()
    : undefined
  if (!pb) {
    setLastRun(row.id, 'error')
    return
  }
  // Dispatch time + optimistic outcome first (crash discipline matches prompts).
  setLastRun(row.id, 'ok')
  try {
    const result = await agentSessionManager.workflowRun(
      subchatId,
      pb.workflowId,
      pb.defaultInputJson ?? undefined
    )
    const now = Date.now()
    db.update(schema.playbooks)
      .set({
        lastRunAt: now,
        lastRunStatus: result.status === 'success' ? 'ok' : 'error',
        updatedAt: now
      })
      .where(eq(schema.playbooks.id, pb.id))
      .run()
    if (result.status !== 'success') setLastRunStatus(row.id, 'error')
    agentSessionManager.postMarker(subchatId, `Scheduled playbook "${pb.name}": ${result.status}`)
    notifyAgentEvent(`Scheduled playbook "${pb.name}" finished`, chatId, subchatId)
  } catch (err) {
    const now = Date.now()
    db.update(schema.playbooks)
      .set({ lastRunAt: now, lastRunStatus: 'error', updatedAt: now })
      .where(eq(schema.playbooks.id, pb.id))
      .run()
    setLastRunStatus(row.id, 'error')
    agentSessionManager.postMarker(
      subchatId,
      `Scheduled playbook "${pb.name}" failed: ${err instanceof Error ? err.message : String(err)}`
    )
    console.error('[schedules] playbook run failed', row.id, err)
  }
}

/** Fire one schedule: resolve the chat, skip when busy, send the marked prompt
 * (or run the linked playbook's workflow). */
async function fireSchedule(row: ScheduleRow): Promise<void> {
  const { chatId, subchatId } = await resolveTarget(row)
  const busy = shouldSkip(
    agentSessionManager.isRunning(subchatId),
    agentSessionManager.queuedPrompts(subchatId).length
  )
  if (busy) {
    setLastRun(row.id, 'skipped')
    return
  }
  if (row.playbookId) {
    await firePlaybook(row, chatId, subchatId)
    return
  }
  // Notify when the run completes; the listener also detaches on host errors
  // so repeated fires can't accumulate listeners.
  const off = agentSessionManager.onEvents(subchatId, (ev) => {
    if (ev.type === 'run-finished') {
      off()
      notifyAgentEvent(`Scheduled run "${row.name}" finished`, chatId, subchatId)
    } else if (ev.type === 'status' && ev.status === 'error') {
      off()
      setLastRunStatus(row.id, 'error')
    }
  })
  try {
    setLastRun(row.id, 'ok')
    await agentSessionManager.sendOrQueue(
      subchatId,
      row.prompt,
      undefined,
      `Scheduled: ${row.name}`,
      'marker'
    )
  } catch (err) {
    off()
    setLastRunStatus(row.id, 'error')
    console.error('[schedules] send failed', row.id, err)
  }
}

/** One pass over enabled schedules: advance due rows, then fire them. */
function tick(): void {
  let rows: ScheduleRow[]
  try {
    rows = getDb().select().from(schema.schedules).where(eq(schema.schedules.enabled, true)).all()
  } catch {
    return // DB closed during shutdown
  }
  const now = Date.now()
  for (const row of rows) {
    if (!isDue(row, now)) continue
    const cadence = parseCadence(row.cadence)
    if (!cadence) {
      // Unreadable cadence: disable instead of error-looping every tick.
      getDb()
        .update(schema.schedules)
        .set({ enabled: false, lastRunStatus: 'error', updatedAt: now })
        .where(eq(schema.schedules.id, row.id))
        .run()
      continue
    }
    // Advance before firing so a crash mid-send can't replay the slot.
    getDb()
      .update(schema.schedules)
      .set({ nextRunAt: computeNextRunAt(cadence, now), updatedAt: now })
      .where(eq(schema.schedules.id, row.id))
      .run()
    void fireSchedule(row).catch((err) => {
      setLastRunStatus(row.id, 'error')
      console.error('[schedules] fire failed', row.id, err)
    })
  }
}

/** Manual "Run now": keeps the busy-skip guard but never moves next_run_at. */
export async function runScheduleNow(id: string): Promise<void> {
  const row = getDb().select().from(schema.schedules).where(eq(schema.schedules.id, id)).get()
  if (!row) throw new Error('Schedule not found')
  await fireSchedule(row)
}

/** Start the 60s tick (+ one shortly after boot for overdue catch-up). */
export function startScheduler(): () => void {
  const interval = setInterval(tick, TICK_MS)
  interval.unref()
  const boot = setTimeout(tick, BOOT_DELAY_MS)
  boot.unref()
  return () => {
    clearInterval(interval)
    clearTimeout(boot)
  }
}
