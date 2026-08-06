/**
 * Pure state machine that decides when an agent run has silently stalled.
 *
 * HTTP timeouts are deliberately disabled in the host (no-timeout-fetch.ts)
 * so slow local models aren't cut off mid-response — but that means a
 * half-dead provider connection can stall the SDK's event stream with no
 * data and no error, leaving the run "running" forever and the prompt queue
 * blocked. This tracker watches total event silence while the run is
 * waiting on the model. Silence while a tool executes or a gate (approval /
 * suspension) waits on the user is expected and never counts as a stall.
 */

/** Max silence between sending a prompt and the run's agent_start. */
export const START_STALL_MS = 2 * 60_000
/**
 * Max silence while waiting on model output. Generous on purpose: a large
 * context prefilling on a slow local model can stream nothing for minutes.
 */
export const RUN_STALL_MS = 10 * 60_000

type Phase = 'idle' | 'starting' | 'running'

export class RunStallTracker {
  private phase: Phase = 'idle'
  private lastEventAt: number
  private fired = false
  /** Tool calls currently executing or parked on a user gate. */
  private readonly openTools = new Set<string>()

  constructor(now: number = Date.now()) {
    this.lastEventAt = now
  }

  /** A prompt was handed to the SDK; agent_start should follow shortly. */
  noteSend(now: number = Date.now()): void {
    if (this.phase === 'idle') this.phase = 'starting'
    this.lastEventAt = now
    this.fired = false
  }

  /** Any SDK event counts as liveness; some also move the run phase. */
  noteEvent(type: string, toolCallId?: unknown, now: number = Date.now()): void {
    this.lastEventAt = now
    const id = typeof toolCallId === 'string' ? toolCallId : null
    switch (type) {
      case 'agent_start':
        this.phase = 'running'
        this.fired = false
        this.openTools.clear()
        break
      case 'agent_end':
        this.phase = 'idle'
        this.openTools.clear()
        break
      case 'tool_start':
      case 'tool_approval_required':
      case 'tool_suspended':
        if (id) this.openTools.add(id)
        break
      case 'tool_end':
      case 'tool_suspension_cancelled':
        if (id) this.openTools.delete(id)
        break
    }
  }

  /** Whether a run is (supposedly) in flight. */
  get active(): boolean {
    return this.phase !== 'idle'
  }

  /** Milliseconds since the last SDK event. */
  silenceMs(now: number = Date.now()): number {
    return now - this.lastEventAt
  }

  /**
   * True exactly once per stall: a run is in flight, nothing is waiting on a
   * tool or the user, and the phase's whole silence budget has elapsed.
   */
  check(now: number = Date.now()): boolean {
    if (this.phase === 'idle' || this.fired) return false
    if (this.openTools.size > 0) return false
    const budget = this.phase === 'starting' ? START_STALL_MS : RUN_STALL_MS
    if (now - this.lastEventAt < budget) return false
    this.fired = true
    return true
  }
}
