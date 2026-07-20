import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cn, timeAgo } from './utils'

describe('cn', () => {
  it('merges conflicting tailwind classes, last one wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('handles conditional classes', () => {
    const enabled = Boolean(process.env.__NEVER_SET__)
    expect(cn('a', enabled && 'b', 'c')).toBe('a c')
  })
})

describe('timeAgo', () => {
  const NOW = 1_700_000_000_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "now" under one minute', () => {
    expect(timeAgo(NOW - 59_000)).toBe('now')
  })

  it('returns minutes under one hour', () => {
    expect(timeAgo(NOW - 59 * 60_000)).toBe('59m')
  })

  it('returns hours from one hour up to a day', () => {
    expect(timeAgo(NOW - 60 * 60_000)).toBe('1h')
    expect(timeAgo(NOW - 23 * 3_600_000)).toBe('23h')
  })

  it('returns days from 24 hours on', () => {
    expect(timeAgo(NOW - 24 * 3_600_000)).toBe('1d')
  })
})
