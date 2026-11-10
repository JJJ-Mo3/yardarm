import { describe, it, expect } from 'vitest'
import {
  computeNextRunAt,
  describeCadence,
  parseCadence,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  type ScheduleCadence
} from './schedules'

/** Local-time timestamp helper (tests run in the machine's timezone). */
function at(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

describe('computeNextRunAt', () => {
  it('interval anchors to from', () => {
    const from = at(2026, 11, 9, 12, 0)
    expect(computeNextRunAt({ kind: 'interval', minutes: 30 }, from)).toBe(from + 30 * 60_000)
  })

  it('interval clamps below the minimum', () => {
    const from = 1_000_000
    expect(computeNextRunAt({ kind: 'interval', minutes: 1 }, from)).toBe(
      from + MIN_INTERVAL_MINUTES * 60_000
    )
  })

  it('interval clamps above the maximum', () => {
    const from = 1_000_000
    expect(computeNextRunAt({ kind: 'interval', minutes: 999_999 }, from)).toBe(
      from + MAX_INTERVAL_MINUTES * 60_000
    )
  })

  it('daily before the time → same day', () => {
    const from = at(2026, 11, 9, 8, 0)
    expect(computeNextRunAt({ kind: 'daily', hour: 9, minute: 30 }, from)).toBe(
      at(2026, 11, 9, 9, 30)
    )
  })

  it('daily after the time → next day', () => {
    const from = at(2026, 11, 9, 10, 0)
    expect(computeNextRunAt({ kind: 'daily', hour: 9, minute: 30 }, from)).toBe(
      at(2026, 11, 10, 9, 30)
    )
  })

  it('daily exactly at the time → strictly future (next day)', () => {
    const from = at(2026, 11, 9, 9, 30)
    expect(computeNextRunAt({ kind: 'daily', hour: 9, minute: 30 }, from)).toBe(
      at(2026, 11, 10, 9, 30)
    )
  })

  it('weekly later this week', () => {
    // 2026-11-09 is a Monday (day 1); target Wednesday (3).
    const from = at(2026, 11, 9, 12, 0)
    expect(computeNextRunAt({ kind: 'weekly', day: 3, hour: 9, minute: 0 }, from)).toBe(
      at(2026, 11, 11, 9, 0)
    )
  })

  it('weekly wraps to next week when the slot already passed', () => {
    // Monday noon; target Monday 09:00 → next Monday.
    const from = at(2026, 11, 9, 12, 0)
    expect(computeNextRunAt({ kind: 'weekly', day: 1, hour: 9, minute: 0 }, from)).toBe(
      at(2026, 11, 16, 9, 0)
    )
  })

  it('weekly same day, later time → today', () => {
    const from = at(2026, 11, 9, 8, 0)
    expect(computeNextRunAt({ kind: 'weekly', day: 1, hour: 9, minute: 0 }, from)).toBe(
      at(2026, 11, 9, 9, 0)
    )
  })

  it('always strictly future even for very overdue from', () => {
    const cadences: ScheduleCadence[] = [
      { kind: 'interval', minutes: 60 },
      { kind: 'daily', hour: 9, minute: 0 },
      { kind: 'weekly', day: 2, hour: 9, minute: 0 }
    ]
    const from = at(2026, 1, 1, 0, 0)
    for (const cadence of cadences) {
      expect(computeNextRunAt(cadence, from)).toBeGreaterThan(from)
    }
  })
})

describe('describeCadence', () => {
  it('renders minutes, hours, and days', () => {
    expect(describeCadence({ kind: 'interval', minutes: 45 })).toBe('every 45m')
    expect(describeCadence({ kind: 'interval', minutes: 120 })).toBe('every 2h')
    expect(describeCadence({ kind: 'interval', minutes: 1440 })).toBe('every 1d')
  })

  it('renders daily and weekly with zero-padded times', () => {
    expect(describeCadence({ kind: 'daily', hour: 9, minute: 5 })).toBe('daily at 09:05')
    expect(describeCadence({ kind: 'weekly', day: 1, hour: 18, minute: 0 })).toBe(
      'weekly on Mon at 18:00'
    )
  })
})

describe('parseCadence', () => {
  it('round-trips valid cadences', () => {
    const cadences: ScheduleCadence[] = [
      { kind: 'interval', minutes: 30 },
      { kind: 'daily', hour: 9, minute: 30 },
      { kind: 'weekly', day: 5, hour: 23, minute: 59 }
    ]
    for (const cadence of cadences) {
      expect(parseCadence(JSON.stringify(cadence))).toEqual(cadence)
    }
  })

  it('rejects garbage', () => {
    expect(parseCadence('not json')).toBeNull()
    expect(parseCadence('null')).toBeNull()
    expect(parseCadence('42')).toBeNull()
    expect(parseCadence('{}')).toBeNull()
    expect(parseCadence(JSON.stringify({ kind: 'interval', minutes: 0 }))).toBeNull()
    expect(parseCadence(JSON.stringify({ kind: 'interval', minutes: 1.5 }))).toBeNull()
    expect(parseCadence(JSON.stringify({ kind: 'daily', hour: 24, minute: 0 }))).toBeNull()
    expect(parseCadence(JSON.stringify({ kind: 'daily', hour: 9, minute: 60 }))).toBeNull()
    expect(parseCadence(JSON.stringify({ kind: 'weekly', day: 7, hour: 9, minute: 0 }))).toBeNull()
    expect(parseCadence(JSON.stringify({ kind: 'monthly', hour: 9, minute: 0 }))).toBeNull()
  })
})
