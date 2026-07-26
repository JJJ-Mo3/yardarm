import { describe, expect, it } from 'vitest'
import { createRetrievalStore } from './retrieval-store'

describe('createRetrievalStore', () => {
  it('stores and returns entries by toolCallId', () => {
    const store = createRetrievalStore({ maxEntries: 10, maxBytes: 1000 })
    store.put('a', 'shell', 'output a')
    expect(store.get('a')).toEqual({ toolName: 'shell', text: 'output a' })
    expect(store.get('missing')).toBeUndefined()
    expect(store.size()).toBe(1)
  })

  it('evicts oldest entries over the count cap', () => {
    const store = createRetrievalStore({ maxEntries: 2, maxBytes: 10_000 })
    store.put('a', 't', 'aa')
    store.put('b', 't', 'bb')
    store.put('c', 't', 'cc')
    expect(store.size()).toBe(2)
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')).toBeDefined()
    expect(store.get('c')).toBeDefined()
  })

  it('evicts oldest entries over the byte cap', () => {
    const store = createRetrievalStore({ maxEntries: 100, maxBytes: 100 })
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.put(id, 't', 'x'.repeat(20))
    expect(store.get('a')).toBeDefined()
    store.put('f', 't', 'y'.repeat(20))
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')).toBeDefined()
    expect(store.get('f')).toBeDefined()
  })

  it('re-putting refreshes recency so live entries survive eviction', () => {
    const store = createRetrievalStore({ maxEntries: 2, maxBytes: 10_000 })
    store.put('a', 't', 'aa')
    store.put('b', 't', 'bb')
    store.put('a', 't', 'aa') // still in the compressed window
    store.put('c', 't', 'cc')
    expect(store.get('a')).toBeDefined()
    expect(store.get('b')).toBeUndefined()
    expect(store.get('c')).toBeDefined()
  })

  it('rejects single entries larger than a quarter of the byte cap', () => {
    const store = createRetrievalStore({ maxEntries: 10, maxBytes: 100 })
    store.put('big', 't', 'x'.repeat(50))
    expect(store.get('big')).toBeUndefined()
    expect(store.size()).toBe(0)
  })
})
