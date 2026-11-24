import { describe, expect, it } from 'vitest'
import {
  CHAT_PORT_MAX,
  CHAT_PORT_MIN,
  chatIdFromTerminalId,
  chatPort,
  devServerPort,
  devServersClash,
  parsePort,
  preferPortUrls,
  urlPort,
  withChatPortEnv
} from './chat-port'

describe('chatPort', () => {
  it('is deterministic and lands on a block of 10 inside the range', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `chat-${i}-3f2b8c1e`)
    for (const id of ids) {
      const port = chatPort(id)
      expect(port).toBe(chatPort(id))
      expect(port).toBeGreaterThanOrEqual(CHAT_PORT_MIN)
      expect(port).toBeLessThanOrEqual(CHAT_PORT_MAX)
      expect(port % 10).toBe(0)
    }
    // Spread: 500 ids should reach most of the 90 blocks.
    expect(new Set(ids.map(chatPort)).size).toBeGreaterThan(80)
  })

  it('is pinned for a known id (stable across releases)', () => {
    expect(chatPort('a')).toBe(4100 + (0xe40c292c % 90) * 10)
  })
})

describe('chatIdFromTerminalId', () => {
  it('reads the chat id out of per-chat terminal ids only', () => {
    expect(chatIdFromTerminalId('chat-abc')).toBe('abc')
    expect(chatIdFromTerminalId('cli-chat-abc')).toBe('abc')
    expect(chatIdFromTerminalId('dev-chat-abc-def')).toBe('abc-def')
    expect(chatIdFromTerminalId('project-abc')).toBeNull()
    expect(chatIdFromTerminalId('dev-project-abc')).toBeNull()
    expect(chatIdFromTerminalId('term-123')).toBeNull()
    expect(chatIdFromTerminalId('chat-')).toBeNull()
  })
})

describe('parsePort', () => {
  it('accepts plain ports only', () => {
    expect(parsePort('3000')).toBe(3000)
    expect(parsePort(' 8080 ')).toBe(8080)
    expect(parsePort(undefined)).toBeNull()
    expect(parsePort('0')).toBeNull()
    expect(parsePort('70000')).toBeNull()
    expect(parsePort('30a0')).toBeNull()
    expect(parsePort('')).toBeNull()
  })
})

describe('withChatPortEnv', () => {
  it('adds the port and the end of its block', () => {
    const env = withChatPortEnv({ FOO: 'bar' }, 'chat-1')
    const port = chatPort('chat-1')
    expect(env).toEqual({
      FOO: 'bar',
      YARDARM_PORT: String(port),
      YARDARM_PORT_RANGE_END: String(port + 9)
    })
  })

  it('never overrides variables the user set', () => {
    expect(withChatPortEnv({ YARDARM_PORT: '5555' }, 'chat-1')).toEqual({ YARDARM_PORT: '5555' })
    const env = withChatPortEnv({ YARDARM_PORT_RANGE_END: '9999' }, 'chat-1')
    expect(env.YARDARM_PORT_RANGE_END).toBe('9999')
    expect(env.YARDARM_PORT).toBe(String(chatPort('chat-1')))
  })

  it('adds nothing without a chat and does not mutate its input', () => {
    const user = { FOO: 'bar' }
    expect(withChatPortEnv(user, null)).toEqual({ FOO: 'bar' })
    withChatPortEnv(user, 'chat-1')
    expect(user).toEqual({ FOO: 'bar' })
  })
})

describe('devServerPort', () => {
  it('prefers a user-fixed PORT, then YARDARM_PORT, then the chat port', () => {
    expect(devServerPort('chat-1', { PORT: '3000', YARDARM_PORT: '5000' })).toBe(3000)
    expect(devServerPort('chat-1', { YARDARM_PORT: '5000' })).toBe(5000)
    expect(devServerPort('chat-1', { PORT: 'auto' })).toBe(chatPort('chat-1'))
    expect(devServerPort('chat-1', {})).toBe(chatPort('chat-1'))
    expect(devServerPort(null, {})).toBeNull()
  })
})

describe('urlPort / preferPortUrls', () => {
  it('reads explicit and default ports', () => {
    expect(urlPort('http://localhost:4100/')).toBe(4100)
    expect(urlPort('http://127.0.0.1')).toBe(80)
    expect(urlPort('https://localhost')).toBe(443)
    expect(urlPort('http://[::1]:5173/app')).toBe(5173)
    expect(urlPort('not a url')).toBeNull()
  })

  it('moves URLs on the preferred port first and otherwise keeps order', () => {
    const urls = ['http://localhost:3000', 'http://localhost:4100/', 'http://127.0.0.1:4100']
    expect(preferPortUrls(urls, 4100)).toEqual([
      'http://localhost:4100/',
      'http://127.0.0.1:4100',
      'http://localhost:3000'
    ])
    expect(preferPortUrls(urls, 9999)).toEqual(urls)
    expect(preferPortUrls(urls, null)).toEqual(urls)
  })
})

describe('devServersClash', () => {
  it('clashes when neither server has a known port', () => {
    expect(devServersClash(null, { port: null, seenPorts: [] })).toBe(true)
  })

  it('clashes on equal ports and not on different ones', () => {
    expect(devServersClash(4100, { port: 4100, seenPorts: [] })).toBe(true)
    expect(devServersClash(4100, { port: 4200, seenPorts: [] })).toBe(false)
    expect(devServersClash(4100, { port: 4200, seenPorts: [4200] })).toBe(false)
    expect(devServersClash(4100, { port: null, seenPorts: [3000] })).toBe(false)
    expect(devServersClash(null, { port: 4200, seenPorts: [4200] })).toBe(false)
  })

  it('clashes when the other server ignored its assigned port', () => {
    expect(devServersClash(4100, { port: 4200, seenPorts: [3000] })).toBe(true)
    // An extra URL (API, HMR) is fine as long as the assigned port shows up.
    expect(devServersClash(4100, { port: 4200, seenPorts: [3000, 4200] })).toBe(false)
  })
})
