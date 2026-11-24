import { describe, expect, it } from 'vitest'
import { parseDeepLink } from '../../shared/deep-link'
import { DeepLinkQueue } from './deep-link-queue'

describe('DeepLinkQueue', () => {
  it('keeps a link that arrives before anyone listens and hands it out once', () => {
    const q = new DeepLinkQueue()
    expect(q.hasPending()).toBe(false)
    expect(q.take()).toBeNull()
    const link = parseDeepLink('yardarm://new?project=a')
    q.put(link)
    expect(q.hasPending()).toBe(true)
    expect(q.take()).toBe(link)
    expect(q.take()).toBeNull()
    expect(q.hasPending()).toBe(false)
  })

  it('keeps only the last uncollected link', () => {
    const q = new DeepLinkQueue()
    const first = parseDeepLink('yardarm://new?project=a')
    const second = parseDeepLink('yardarm://new?project=b')
    q.put(first)
    q.put(second)
    expect(q.take()).toBe(second)
    expect(q.take()).toBeNull()
  })

  it('signals listeners until they unsubscribe; only one collector gets the link', () => {
    const q = new DeepLinkQueue()
    const got: unknown[] = []
    const offA = q.onSignal(() => got.push(q.take()))
    q.onSignal(() => got.push(q.take()))
    const link = parseDeepLink('yardarm://bogus')
    q.put(link)
    expect(got).toEqual([link, null])
    offA()
    q.put(link)
    expect(got).toEqual([link, null, link])
  })

  it('isolates a throwing listener', () => {
    const q = new DeepLinkQueue()
    let called = 0
    q.onSignal(() => {
      throw new Error('boom')
    })
    q.onSignal(() => called++)
    expect(() => q.put(parseDeepLink('yardarm://new'))).not.toThrow()
    expect(called).toBe(1)
  })
})
