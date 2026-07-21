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
