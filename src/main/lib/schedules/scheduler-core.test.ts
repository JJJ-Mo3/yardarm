import { describe, it, expect } from 'vitest'
import { isDue, shouldSkip, chatUsable } from './scheduler-core'

describe('isDue', () => {
  it('fires when enabled and next_run_at has passed', () => {
    expect(isDue({ enabled: true, nextRunAt: 999 }, 1000)).toBe(true)
    expect(isDue({ enabled: true, nextRunAt: 1000 }, 1000)).toBe(true)
  })

  it('does not fire when disabled, unscheduled, or still in the future', () => {
    expect(isDue({ enabled: false, nextRunAt: 999 }, 1000)).toBe(false)
    expect(isDue({ enabled: true, nextRunAt: null }, 1000)).toBe(false)
    expect(isDue({ enabled: true, nextRunAt: 1001 }, 1000)).toBe(false)
  })
})

describe('shouldSkip', () => {
  it('skips when the target is running or has queued prompts', () => {
    expect(shouldSkip(true, 0)).toBe(true)
    expect(shouldSkip(false, 1)).toBe(true)
    expect(shouldSkip(true, 2)).toBe(true)
  })

  it('fires into an idle, empty-queue target', () => {
    expect(shouldSkip(false, 0)).toBe(false)
  })
})

describe('chatUsable', () => {
  it('treats missing and archived chats as unusable', () => {
    expect(chatUsable(undefined)).toBe(false)
    expect(chatUsable({ archived: true })).toBe(false)
    expect(chatUsable({ archived: false })).toBe(true)
  })
})
