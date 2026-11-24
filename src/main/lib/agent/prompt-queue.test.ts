import { describe, expect, it } from 'vitest'
import { PromptQueue } from './prompt-queue'

describe('PromptQueue', () => {
  it('preserves FIFO order per subchat', () => {
    const q = new PromptQueue()
    q.enqueue('a', 'first')
    q.enqueue('a', 'second')
    q.enqueue('b', 'other chat')
    expect(q.size('a')).toBe(2)
    expect(q.shift('a')?.text).toBe('first')
    expect(q.shift('a')?.text).toBe('second')
    expect(q.shift('a')).toBeUndefined()
    expect(q.shift('b')?.text).toBe('other chat')
  })

  it('dismisses items by id', () => {
    const q = new PromptQueue()
    q.enqueue('a', 'keep')
    const drop = q.enqueue('a', 'drop')
    expect(q.dismiss('a', drop.id)).toBe(true)
    expect(q.dismiss('a', drop.id)).toBe(false)
    expect(q.dismiss('missing', 'nope')).toBe(false)
    expect(q.list('a').map((i) => i.text)).toEqual(['keep'])
  })

  it('unshift puts a failed send back at the front', () => {
    const q = new PromptQueue()
    q.enqueue('a', 'one')
    q.enqueue('a', 'two')
    const head = q.shift('a')!
    q.unshift('a', head)
    expect(q.list('a').map((i) => i.text)).toEqual(['one', 'two'])
  })

  it('reorders items before a target or to the end', () => {
    const q = new PromptQueue()
    const one = q.enqueue('a', 'one')
    q.enqueue('a', 'two')
    const three = q.enqueue('a', 'three')
    // Move three before one → three, one, two
    expect(q.reorder('a', three.id, one.id)).toBe(true)
    expect(q.list('a').map((i) => i.text)).toEqual(['three', 'one', 'two'])
    // Move three to the end → one, two, three
    expect(q.reorder('a', three.id)).toBe(true)
    expect(q.list('a').map((i) => i.text)).toEqual(['one', 'two', 'three'])
    // No-ops: same position, self target, unknown ids
    expect(q.reorder('a', three.id)).toBe(false)
    expect(q.reorder('a', one.id, one.id)).toBe(false)
    expect(q.reorder('a', 'missing', one.id)).toBe(false)
    expect(q.reorder('missing', one.id)).toBe(false)
    // Unknown beforeId falls back to append
    expect(q.reorder('a', one.id, 'missing')).toBe(true)
    expect(q.list('a').map((i) => i.text)).toEqual(['two', 'three', 'one'])
  })

  it('take removes one item and insertAt restores its position', () => {
    const q = new PromptQueue()
    q.enqueue('a', 'one')
    const two = q.enqueue('a', 'two')
    q.enqueue('a', 'three')
    const taken = q.take('a', two.id)
    expect(taken).toMatchObject({ index: 1, item: { text: 'two' } })
    expect(q.list('a').map((i) => i.text)).toEqual(['one', 'three'])
    expect(q.take('a', two.id)).toBeUndefined()
    expect(q.take('missing', two.id)).toBeUndefined()
    if (taken) q.insertAt('a', taken.index, taken.item)
    expect(q.list('a').map((i) => i.text)).toEqual(['one', 'two', 'three'])
    // The queue may have drained meanwhile — the index is clamped.
    const head = q.take('a', q.list('a')[0].id)
    q.shift('a')
    q.shift('a')
    if (head) q.insertAt('a', 5, head.item)
    expect(q.list('a').map((i) => i.text)).toEqual(['one'])
  })

  it('list exposes counts, never file payloads', () => {
    const q = new PromptQueue()
    q.enqueue('a', 'with files', [
      { data: 'aGk=', mediaType: 'image/png', filename: 'x.png' },
      { data: 'aGk=', mediaType: 'image/png' }
    ])
    q.enqueue('a', 'plain', [])
    const list = q.list('a')
    expect(list[0]).toMatchObject({ text: 'with files', fileCount: 2 })
    expect(list[1]).toMatchObject({ text: 'plain', fileCount: 0 })
    expect(Object.keys(list[0])).not.toContain('files')
    expect(list[0].id).toBeTruthy()
    expect(list[0].createdAt).toBeGreaterThan(0)
  })
})
