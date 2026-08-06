/**
 * Pure state machine that decides when an agent run has silently stalled.
 *
 * HTTP timeouts are deliberately disabled in the host (no-timeout-fetch.ts)
 * so slow local models aren't cut off mid-response — but that means a
 * half-dead provider connection can stall the SDK's event stream with no
 * data and no error, leaving the run "running" forever and the prompt queue
 * blocked. This tracker watches total event silence while a run is in
 * flight, with three regimes:
 *
 * - Waiting on the model: the per-phase budget (START/RUN) applies.
 * - A tool is executing: a much larger budget applies, because long builds
 *   and test suites are legitimate — but a live tool streams events
 *   (shell_output, tool_update) that reset the clock, so only a truly
 *   wedged tool (or a lost tool_end) ever trips it.
 * - A gate (approval / suspension) is waiting on the user: silence is
 *   legitimate indefinitely and nothing ever fires. The moment the host
 *   forwards the user's response, the gate counts as executing again so a
 *   stream that dies right after a resume still gets caught.
 */

/** Max silence between sending a prompt and the run's agent_start. */
export const START_STALL_MS = 2 * 60_000
/**
 * Max silence while waiting on model output. Generous on purpose: a large
 * context prefilling on a slow local model can stream nothing for minutes.
 */
export const RUN_STALL_MS = 10 * 60_000
/**
 * Max total event silence while a tool call is executing. Live tools emit
 * shell_output / tool_update events that reset the clock, so this only
 * catches tools that are wedged outright.
 */
export const TOOL_STALL_MS = 30 * 60_000

type Phase = 'idle' | 'starting' | 'running'

export class RunStallTracker {
  private phase: Phase = 'idle'
  private lastEventAt: number
  private fired = false
  /** Tool calls currently executing (tool_start seen, no tool_end yet). */
  private readonly executing = new Set<string>()
  /** Tool calls parked on a user gate (approval or suspension). */
  private readonly gates = new Set<string>()

  constructor(now: number = Date.now()) {
    this.lastEventAt = now
  }

  /** A prompt was handed to the SDK; agent_start should follow shortly. */
  noteSend(now: number = Date.now()): void {
    if (this.phase === 'idle') this.phase = 'starting'
    this.lastEventAt = now
    this.fired = false
  }

  /**
   * The user answered a gate (tool approval or suspension resume). The run
   * is no longer waiting on a human — treat the call as executing so a
   * stream that dies during the resume still gets caught.
   */
  noteGateResponse(toolCallId: unknown, now: number = Date.now()): void {
    this.lastEventAt = now
    this.fired = false
    if (typeof toolCallId !== 'string') return
    if (this.gates.delete(toolCallId)) this.executing.add(toolCallId)
  }

  /** Any SDK event counts as liveness; some also move the run phase. */
  noteEvent(type: string, toolCallId?: unknown, now: number = Date.now()): void {
    this.lastEventAt = now
    const id = typeof toolCallId === 'string' ? toolCallId : null
    switch (type) {
      case 'agent_start':
        this.phase = 'running'
        this.fired = false
        this.executing.clear()
        this.gates.clear()
        break
      case 'agent_end':
        this.phase = 'idle'
        this.executing.clear()
        this.gates.clear()
        break
      case 'tool_start':
        if (id) {
          this.executing.add(id)
          this.gates.delete(id)
        }
        break
      case 'tool_approval_required':
      case 'tool_suspended':
        if (id) {
          this.gates.add(id)
          this.executing.delete(id)
        }
        break
      case 'tool_end':
        if (id) {
          this.executing.delete(id)
          this.gates.delete(id)
        }
        break
      case 'tool_suspension_cancelled':
        if (id) this.gates.delete(id)
        break
    }
  }

  /** Whether a run is (supposedly) in flight. */
  get active(): boolean {
    return this.phase !== 'idle'
  }

  /** Whether the current silence happened during a tool execution. */
  get stalledInTool(): boolean {
    return this.executing.size > 0
  }

  /** Milliseconds since the last SDK event. */
  silenceMs(now: number = Date.now()): number {
    return now - this.lastEventAt
  }

  /**
   * True exactly once per stall: a run is in flight, nothing is waiting on
   * the user, and the applicable silence budget has fully elapsed.
   */
  check(now: number = Date.now()): boolean {
    if (this.phase === 'idle' || this.fired) return false
    if (this.gates.size > 0) return false
    const budget =
      this.executing.size > 0
        ? TOOL_STALL_MS
        : this.phase === 'starting'
          ? START_STALL_MS
          : RUN_STALL_MS
    if (now - this.lastEventAt < budget) return false
    this.fired = true
    return true
  }
}
