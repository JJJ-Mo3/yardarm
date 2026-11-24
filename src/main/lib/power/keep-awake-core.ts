/**
 * Pure keep-awake logic (no Electron imports, unit-tested): decides whether
 * the machine should be held awake from the running state + the user
 * preference, and owns the single power-save-blocker id so a blocker can
 * never leak — it is always stopped by id, and every operation is idempotent.
 */

/** app_settings key for "Keep the computer awake while agents are running" (default on). */
export const KEEP_AWAKE_SETTING_KEY = 'keepAwake'

/** Parses the stored app_settings value; absent or corrupt means on. */
export function parseKeepAwakeSetting(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return true
  try {
    return (JSON.parse(raw) as unknown) !== false
  } catch {
    return true
  }
}

/** The whole decision: block sleep only while a run is active and the preference is on. */
export function shouldKeepAwake(input: { anyRunning: boolean; enabled: boolean }): boolean {
  return input.anyRunning && input.enabled
}

/** The slice of Electron's powerSaveBlocker the controller needs (injected for tests). */
export interface PowerBlockerApi {
  start(): number
  stop(id: number): void
  isStarted(id: number): boolean
}

/** Holds at most one blocker and reconciles it against the desired state. */
export class KeepAwakeController {
  private blockerId: number | null = null

  constructor(private readonly api: PowerBlockerApi) {}

  /** Whether a blocker is currently held. */
  get active(): boolean {
    return this.blockerId !== null
  }

  /** Reconcile the blocker with the current inputs; returns whether one is held afterwards. */
  sync(input: { anyRunning: boolean; enabled: boolean }): boolean {
    if (!shouldKeepAwake(input)) {
      this.release()
      return false
    }
    if (this.blockerId !== null) {
      let alive = false
      try {
        alive = this.api.isStarted(this.blockerId)
      } catch {
        // treated as not started — replaced below
      }
      if (alive) return true
      // The id went stale behind our back: drop it (stopping by id first, in
      // case the liveness answer was wrong) before taking a fresh one.
      this.release()
    }
    try {
      this.blockerId = this.api.start()
    } catch {
      this.blockerId = null
    }
    return this.blockerId !== null
  }

  /** Stop the held blocker, if any. Safe to call repeatedly. */
  release(): void {
    const id = this.blockerId
    if (id === null) return
    this.blockerId = null
    try {
      this.api.stop(id)
    } catch {
      // best-effort: the id is forgotten either way
    }
  }
}
