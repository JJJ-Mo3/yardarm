import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentUIEvent, StoredMessage } from '../../../shared/ui-message'
import { createUpsertThrottle } from './upsert-throttle'

function upsert(id: string, text: string): AgentUIEvent {
  const message: StoredMessage = {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text }],
    createdAt: 0
  }
  return { type: 'message-upsert', message }
}

function textOf(ev: AgentUIEvent): string {
  if (ev.type !== 'message-upsert') throw new Error('not an upsert')
  return (ev.message.parts[0] as { text: string }).text
}

describe('createUpsertThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits the first upsert immediately (leading edge)', () => {
    const out: AgentUIEvent[] = []
    const throttle = createUpsertThrottle((ev) => out.push(ev), 50)
    throttle.emit(upsert('m1', 'v1'))
    expect(out).toHaveLength(1)
  })

  it('coalesces a burst into one trailing emit with the latest snapshot', () => {
    const out: AgentUIEvent[] = []
    const throttle = createUpsertThrottle((ev) => out.push(ev), 50)
    throttle.emit(upsert('m1', 'v1'))
    throttle.emit(upsert('m1', 'v2'))
    throttle.emit(upsert('m1', 'v3'))
    expect(out).toHaveLength(1)
    vi.advanceTimersByTime(50)
    expect(out).toHaveLength(2)
    expect(textOf(out[1])).toBe('v3')
  })

  it('throttles independently per message id', () => {
    const out: AgentUIEvent[] = []
    const throttle = createUpsertThrottle((ev) => out.push(ev), 50)
    throttle.emit(upsert('m1', 'a'))
    throttle.emit(upsert('m2', 'b'))
    expect(out).toHaveLength(2)
  })

  it('passes other event types through synchronously', () => {
    const out: AgentUIEvent[] = []
    const throttle = createUpsertThrottle((ev) => out.push(ev), 50)
    throttle.emit({ type: 'run-started' })
    throttle.emit({ type: 'status', status: 'ready' })
    expect(out.map((e) => e.type)).toEqual(['run-started', 'status'])
  })

  it('drops pending upserts when a messages-reset passes through', () => {
    const out: AgentUIEvent[] = []
    const throttle = createUpsertThrottle((ev) => out.push(ev), 50)
    throttle.emit(upsert('m1', 'v1'))
    throttle.emit(upsert('m1', 'v2'))
    throttle.emit({ type: 'messages-reset', messages: [] })
    vi.advanceTimersByTime(200)
    expect(out.map((e) => e.type)).toEqual(['message-upsert', 'messages-reset'])
  })

  it('dispose cancels timers and blocks further emits', () => {
    const out: AgentUIEvent[] = []
    const throttle = createUpsertThrottle((ev) => out.push(ev), 50)
    throttle.emit(upsert('m1', 'v1'))
    throttle.emit(upsert('m1', 'v2'))
    throttle.dispose()
    vi.advanceTimersByTime(200)
    throttle.emit(upsert('m1', 'v3'))
    expect(out).toHaveLength(1)
  })
})
