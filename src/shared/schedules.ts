/**
 * Scheduled runs (Devin-style scheduled sessions): the cadence model shared
 * by the main-process scheduler (computes next_run_at) and the renderer
 * (cadence picker + descriptions). Pure date math on local wall-clock time —
 * a DST transition makes one daily/weekly occurrence land an hour off once,
 * then self-corrects; that is accepted rather than engineered around.
 */

export type ScheduleCadence =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; day: number; hour: number; minute: number }

/** Interval bounds: 5 minutes to 7 days. */
export const MIN_INTERVAL_MINUTES = 5
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Next occurrence strictly after `from` (epoch ms, local time). Interval
 * cadences anchor to `from` itself (fire-once catch-up: overdue schedules
 * re-anchor to "now" instead of replaying missed occurrences).
 */
export function computeNextRunAt(cadence: ScheduleCadence, from: number): number {
  if (cadence.kind === 'interval') {
    const minutes = Math.min(Math.max(cadence.minutes, MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES)
    return from + minutes * 60_000
  }
  const next = new Date(from)
  next.setHours(cadence.hour, cadence.minute, 0, 0)
  if (cadence.kind === 'daily') {
    if (next.getTime() <= from) next.setDate(next.getDate() + 1)
    return next.getTime()
  }
  // weekly
  const delta = (cadence.day - next.getDay() + 7) % 7
  next.setDate(next.getDate() + delta)
  if (next.getTime() <= from) next.setDate(next.getDate() + 7)
  return next.getTime()
}

/** Two-digit zero-padded number for HH:MM rendering. */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Human description: "every 30m", "daily at 09:00", "weekly on Mon at 09:00". */
export function describeCadence(cadence: ScheduleCadence): string {
  switch (cadence.kind) {
    case 'interval': {
      const m = cadence.minutes
      if (m % 1440 === 0) return `every ${m / 1440}d`
      if (m % 60 === 0) return `every ${m / 60}h`
      return `every ${m}m`
    }
    case 'daily':
      return `daily at ${pad(cadence.hour)}:${pad(cadence.minute)}`
    case 'weekly':
      return `weekly on ${WEEKDAY_NAMES[cadence.day] ?? '?'} at ${pad(cadence.hour)}:${pad(cadence.minute)}`
  }
}

/** Lenient parse of the JSON cadence column; null on any malformed value. */
export function parseCadence(raw: string): ScheduleCadence | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const c = parsed as Record<string, unknown>
  const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
  if (c.kind === 'interval' && int(c.minutes) && c.minutes > 0) {
    return { kind: 'interval', minutes: c.minutes }
  }
  const validTime =
    int(c.hour) && c.hour >= 0 && c.hour <= 23 && int(c.minute) && c.minute >= 0 && c.minute <= 59
  if (c.kind === 'daily' && validTime) {
    return { kind: 'daily', hour: c.hour as number, minute: c.minute as number }
  }
  if (c.kind === 'weekly' && validTime && int(c.day) && c.day >= 0 && c.day <= 6) {
    return {
      kind: 'weekly',
      day: c.day as number,
      hour: c.hour as number,
      minute: c.minute as number
    }
  }
  return null
}
