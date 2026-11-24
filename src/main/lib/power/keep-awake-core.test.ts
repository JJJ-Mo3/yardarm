import { describe, expect, it } from 'vitest'
import {
  KeepAwakeController,
  parseKeepAwakeSetting,
  shouldKeepAwake,
  type PowerBlockerApi
} from './keep-awake-core'

/** Fake blocker registry recording every call. */
function fakeApi(): PowerBlockerApi & { live: Set<number>; starts: number; stops: number[] } {
  let next = 1
  const api = {
    live: new Set<number>(),
    starts: 0,
    stops: [] as number[],
    start(): number {
      const id = next++
      api.live.add(id)
      api.starts++
      return id
    },
    stop(id: number): void {
      api.stops.push(id)
      api.live.delete(id)
    },
    isStarted(id: number): boolean {
      return api.live.has(id)
    }
  }
  return api
}

describe('parseKeepAwakeSetting', () => {
  it('defaults to on when absent or corrupt', () => {
    expect(parseKeepAwakeSetting(undefined)).toBe(true)
    expect(parseKeepAwakeSetting(null)).toBe(true)
    expect(parseKeepAwakeSetting('{not json')).toBe(true)
    expect(parseKeepAwakeSetting('null')).toBe(true)
  })

  it('is off only for an explicit false', () => {
    expect(parseKeepAwakeSetting('false')).toBe(false)
    expect(parseKeepAwakeSetting('true')).toBe(true)
    expect(parseKeepAwakeSetting('0')).toBe(true)
  })
})

describe('shouldKeepAwake', () => {
  it('requires both a running agent and the preference', () => {
    expect(shouldKeepAwake({ anyRunning: true, enabled: true })).toBe(true)
    expect(shouldKeepAwake({ anyRunning: true, enabled: false })).toBe(false)
    expect(shouldKeepAwake({ anyRunning: false, enabled: true })).toBe(false)
    expect(shouldKeepAwake({ anyRunning: false, enabled: false })).toBe(false)
  })
})

describe('KeepAwakeController', () => {
  it('starts one blocker while running and stops it by id when idle', () => {
    const api = fakeApi()
    const c = new KeepAwakeController(api)
    expect(c.sync({ anyRunning: true, enabled: true })).toBe(true)
    expect(c.sync({ anyRunning: true, enabled: true })).toBe(true)
    expect(api.starts).toBe(1)
    expect(c.active).toBe(true)
    expect(c.sync({ anyRunning: false, enabled: true })).toBe(false)
    expect(api.stops).toEqual([1])
    expect(api.live.size).toBe(0)
    expect(c.active).toBe(false)
  })

  it('releases when the preference is turned off mid-run', () => {
    const api = fakeApi()
    const c = new KeepAwakeController(api)
    c.sync({ anyRunning: true, enabled: true })
    c.sync({ anyRunning: true, enabled: false })
    expect(api.live.size).toBe(0)
    c.sync({ anyRunning: true, enabled: true })
    expect(api.starts).toBe(2)
    expect(api.live.size).toBe(1)
  })

  it('release is idempotent and never stops an id twice', () => {
    const api = fakeApi()
    const c = new KeepAwakeController(api)
    c.release()
    c.sync({ anyRunning: true, enabled: true })
    c.release()
    c.release()
    c.sync({ anyRunning: false, enabled: true })
    expect(api.stops).toEqual([1])
  })

  it('replaces a blocker that went stale without leaking the old id', () => {
    const api = fakeApi()
    const c = new KeepAwakeController(api)
    c.sync({ anyRunning: true, enabled: true })
    api.live.delete(1)
    expect(c.sync({ anyRunning: true, enabled: true })).toBe(true)
    expect(api.stops).toEqual([1])
    expect([...api.live]).toEqual([2])
  })

  it('survives a throwing blocker api', () => {
    const c = new KeepAwakeController({
      start: () => {
        throw new Error('unsupported')
      },
      stop: () => {
        throw new Error('unsupported')
      },
      isStarted: () => false
    })
    expect(c.sync({ anyRunning: true, enabled: true })).toBe(false)
    expect(c.active).toBe(false)
    expect(() => c.release()).not.toThrow()
  })

  it('forgets the id even when stop throws', () => {
    const api = fakeApi()
    const c = new KeepAwakeController({
      start: () => api.start(),
      isStarted: (id) => api.isStarted(id),
      stop: () => {
        throw new Error('boom')
      }
    })
    c.sync({ anyRunning: true, enabled: true })
    c.release()
    expect(c.active).toBe(false)
  })
})
