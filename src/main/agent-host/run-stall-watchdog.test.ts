/** Tests for the stalled-run tracker's phase, suppression, and one-shot logic. */
import { describe, expect, it } from 'vitest'
import { RUN_STALL_MS, RunStallTracker, START_STALL_MS } from './run-stall-watchdog'

describe('RunStallTracker', () => {
  it('never fires while idle, no matter how long the silence', () => {
    const t = new RunStallTracker(0)
    expect(t.check(RUN_STALL_MS * 100)).toBe(false)
    expect(t.active).toBe(false)
  })

  it('fires once when a sent prompt never produces agent_start', () => {
    const t = new RunStallTracker(0)
    t.noteSend(0)
    expect(t.check(START_STALL_MS - 1)).toBe(false)
    expect(t.check(START_STALL_MS)).toBe(true)
    expect(t.check(START_STALL_MS * 5)).toBe(false) // one-shot
  })

  it('fires after prolonged silence while waiting on the model', () => {
    const t = new RunStallTracker(0)
    t.noteSend(0)
    t.noteEvent('agent_start', undefined, 1_000)
    expect(t.check(1_000 + RUN_STALL_MS - 1)).toBe(false)
    expect(t.check(1_000 + RUN_STALL_MS)).toBe(true)
  })

  it('any event resets the silence clock', () => {
    const t = new RunStallTracker(0)
    t.noteEvent('agent_start', undefined, 0)
    t.noteEvent('message_update', undefined, RUN_STALL_MS - 1)
    expect(t.check(RUN_STALL_MS)).toBe(false)
    expect(t.check(RUN_STALL_MS * 2 - 2)).toBe(false)
    expect(t.check(RUN_STALL_MS * 2 - 1)).toBe(true)
  })

  it('is suppressed while a tool executes and re-arms when it ends', () => {
    const t = new RunStallTracker(0)
    t.noteEvent('agent_start', undefined, 0)
    t.noteEvent('tool_start', 't1', 100)
    expect(t.check(100 + RUN_STALL_MS * 10)).toBe(false)
    const end = 100 + RUN_STALL_MS * 10
    t.noteEvent('tool_end', 't1', end)
    expect(t.check(end + RUN_STALL_MS - 1)).toBe(false)
    expect(t.check(end + RUN_STALL_MS)).toBe(true)
  })

  it('is suppressed while an approval or suspension waits on the user', () => {
    const approvals = new RunStallTracker(0)
    approvals.noteEvent('agent_start', undefined, 0)
    approvals.noteEvent('tool_approval_required', 't1', 100)
    expect(approvals.check(RUN_STALL_MS * 10)).toBe(false)

    const suspensions = new RunStallTracker(0)
    suspensions.noteEvent('agent_start', undefined, 0)
    suspensions.noteEvent('tool_suspended', 't1', 100)
    expect(suspensions.check(RUN_STALL_MS * 10)).toBe(false)
    suspensions.noteEvent('tool_suspension_cancelled', 't1', 200)
    expect(suspensions.check(200 + RUN_STALL_MS)).toBe(true)
  })

  it('agent_end deactivates and clears open tools; agent_start re-arms after a fire', () => {
    const t = new RunStallTracker(0)
    t.noteEvent('agent_start', undefined, 0)
    expect(t.check(RUN_STALL_MS)).toBe(true) // stall fires
    t.noteEvent('agent_end', undefined, RUN_STALL_MS + 1)
    expect(t.active).toBe(false)
    // Next run starts fresh, including any tool ids left over from before.
    t.noteEvent('tool_start', 't1', RUN_STALL_MS + 2)
    t.noteEvent('agent_start', undefined, RUN_STALL_MS + 3)
    const base = RUN_STALL_MS + 3
    expect(t.check(base + RUN_STALL_MS - 1)).toBe(false)
    expect(t.check(base + RUN_STALL_MS)).toBe(true)
  })

  it('a mid-run send does not regress the phase to starting', () => {
    const t = new RunStallTracker(0)
    t.noteEvent('agent_start', undefined, 0)
    t.noteSend(1_000)
    expect(t.check(1_000 + START_STALL_MS)).toBe(false) // running budget applies
    expect(t.check(1_000 + RUN_STALL_MS)).toBe(true)
  })
})
