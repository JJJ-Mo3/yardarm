/**
 * Keeps the computer awake while agents run: holds one Electron
 * `powerSaveBlocker` ('prevent-app-suspension' — the display may still turn
 * off, the machine does not sleep mid-run) while at least one agent run is
 * active and the `keepAwake` app setting is on (default on). Re-evaluated on
 * every session-manager status change, when the preference is saved
 * (settings router), and on a slow safety poll that also covers runs the
 * status broadcast does not report. The decision and blocker bookkeeping live
 * in keep-awake-core.ts.
 */
import { powerSaveBlocker } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { agentSessionManager } from '../agent/agent-session-manager'
import {
  KEEP_AWAKE_SETTING_KEY,
  KeepAwakeController,
  parseKeepAwakeSetting
} from './keep-awake-core'

/** Safety-net re-evaluation interval; status events do the timely work. */
const POLL_MS = 15_000

const controller = new KeepAwakeController({
  start: () => powerSaveBlocker.start('prevent-app-suspension'),
  stop: (id) => powerSaveBlocker.stop(id),
  isStarted: (id) => powerSaveBlocker.isStarted(id)
})

let started = false

function keepAwakeEnabled(): boolean {
  try {
    const row = getDb()
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, KEEP_AWAKE_SETTING_KEY))
      .get()
    return parseKeepAwakeSetting(row?.value)
  } catch {
    return true
  }
}

/** Re-evaluate now (no-op until started and after stop). */
export function refreshKeepAwake(): void {
  if (!started) return
  try {
    controller.sync({ anyRunning: agentSessionManager.anyRunning(), enabled: keepAwakeEnabled() })
  } catch {
    // Never let power management break a status broadcast or settings write.
    controller.release()
  }
}

/** Start tracking agent runs (after the DB is ready); returns the stopper for app quit. */
export function startKeepAwake(): () => void {
  if (started) return () => {}
  started = true
  const offStatus = agentSessionManager.onStatus(() => refreshKeepAwake())
  const timer = setInterval(refreshKeepAwake, POLL_MS)
  timer.unref()
  refreshKeepAwake()
  return () => {
    started = false
    offStatus()
    clearInterval(timer)
    controller.release()
  }
}
