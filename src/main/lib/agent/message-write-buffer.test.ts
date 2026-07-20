import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredMessage } from '../../../shared/ui-message'
import { MessageWriteBuffer } from './message-write-buffer'

function msg(id: string, text: string): StoredMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }], createdAt: 0 }
}

describe('MessageWriteBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid enqueues into one write of the latest snapshot', () => {
    const writes: Array<[string, StoredMessage]> = []
    const buffer = new MessageWriteBuffer((sid, m) => writes.push([sid, m]), 400)
    buffer.enqueue('s1', msg('m1', 'v1'))
    buffer.enqueue('s1', msg('m1', 'v2'))
    buffer.enqueue('s1', msg('m1', 'v3'))
    expect(writes).toHaveLength(0)
    vi.advanceTimersByTime(400)
    expect(writes).toHaveLength(1)
    expect((writes[0][1].parts[0] as { text: string }).text).toBe('v3')
  })

  it('resets the debounce timer on re-enqueue', () => {
    const writes: StoredMessage[] = []
    const buffer = new MessageWriteBuffer((_sid, m) => writes.push(m), 400)
    buffer.enqueue('s1', msg('m1', 'v1'))
    vi.advanceTimersByTime(300)
    buffer.enqueue('s1', msg('m1', 'v2'))
    vi.advanceTimersByTime(300)
    expect(writes).toHaveLength(0)
    vi.advanceTimersByTime(100)
    expect(writes).toHaveLength(1)
    expect((writes[0].parts[0] as { text: string }).text).toBe('v2')
  })

  it('writes immediately with flush: true and cancels the pending timer', () => {
    const writes: StoredMessage[] = []
    const buffer = new MessageWriteBuffer((_sid, m) => writes.push(m), 400)
    buffer.enqueue('s1', msg('m1', 'v1'))
    buffer.enqueue('s1', msg('m1', 'v2'), { flush: true })
    expect(writes).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(writes).toHaveLength(1)
    expect((writes[0].parts[0] as { text: string }).text).toBe('v2')
  })

  it('flushes only the requested subchat, or everything without an argument', () => {
    const writes: Array<[string, string]> = []
    const buffer = new MessageWriteBuffer((sid, m) => writes.push([sid, m.id]), 400)
    buffer.enqueue('s1', msg('m1', 'a'))
    buffer.enqueue('s2', msg('m2', 'b'))
    buffer.flush('s1')
    expect(writes).toEqual([['s1', 'm1']])
    buffer.flush()
    expect(writes).toEqual([
      ['s1', 'm1'],
      ['s2', 'm2']
    ])
    vi.advanceTimersByTime(1000)
    expect(writes).toHaveLength(2)
  })

  it('does not rewrite after a flush drained the entry', () => {
    const writes: StoredMessage[] = []
    const buffer = new MessageWriteBuffer((_sid, m) => writes.push(m), 400)
    buffer.enqueue('s1', msg('m1', 'v1'))
    buffer.flush('s1')
    vi.advanceTimersByTime(1000)
    expect(writes).toHaveLength(1)
  })

  it('keeps working after a write throws', () => {
    let calls = 0
    const buffer = new MessageWriteBuffer(() => {
      calls++
      if (calls === 1) throw new Error('boom')
    }, 400)
    buffer.enqueue('s1', msg('m1', 'v1'), { flush: true })
    buffer.enqueue('s1', msg('m1', 'v2'), { flush: true })
    expect(calls).toBe(2)
  })
})
