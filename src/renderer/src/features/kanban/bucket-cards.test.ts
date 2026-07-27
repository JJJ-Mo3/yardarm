import { describe, expect, it } from 'vitest'
import { bucketCards, sortOrderBefore } from './bucket-cards'

const card = (
  column: string,
  chatId: string | null,
  sortOrder: number
): { column: string; chatId: string | null; sortOrder: number } => ({ column, chatId, sortOrder })

describe('bucketCards', () => {
  it('places undispatched cards in their authored column, sorted', () => {
    const b = bucketCards([card('todo', null, 2), card('backlog', null, 1), card('todo', null, 1)])
    expect(b.backlog.map((c) => c.sortOrder)).toEqual([1])
    expect(b.todo.map((c) => c.sortOrder)).toEqual([1, 2])
    expect(b.done).toEqual([])
    expect(b.byChatId.size).toBe(0)
  })

  it('hides dispatched cards from authored columns but maps them by chat', () => {
    const dispatched = card('todo', 'chat-1', 1)
    const b = bucketCards([dispatched])
    expect(b.backlog).toEqual([])
    expect(b.todo).toEqual([])
    expect(b.byChatId.get('chat-1')).toBe(dispatched)
  })

  it('puts done cards in Done regardless of dispatch state', () => {
    const b = bucketCards([card('done', 'chat-1', 2), card('done', null, 1)])
    expect(b.done.map((c) => c.sortOrder)).toEqual([1, 2])
    expect(b.byChatId.has('chat-1')).toBe(true)
  })

  it('treats unknown authored columns as backlog', () => {
    const b = bucketCards([card('bogus', null, 1)])
    expect(b.backlog).toHaveLength(1)
  })
})

describe('sortOrderBefore', () => {
  it('uses the midpoint between the previous card and the target', () => {
    const a = card('todo', null, 1)
    const b = card('todo', null, 2)
    expect(sortOrderBefore([a, b], b)).toBe(1.5)
  })

  it('goes below the first card when dropping at the top', () => {
    const a = card('todo', null, 1)
    expect(sortOrderBefore([a], a)).toBe(0)
  })
})
