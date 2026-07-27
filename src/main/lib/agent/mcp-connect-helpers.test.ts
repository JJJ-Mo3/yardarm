import { describe, expect, it } from 'vitest'
import { isSettledMcpStatus, syntheticMcpFailureStatus } from './mcp-connect-helpers'
import type { McpServerStatusInfo } from '../../../shared/ipc-types'

function status(partial: Partial<McpServerStatusInfo>): McpServerStatusInfo {
  return {
    name: 'test',
    connected: false,
    toolCount: 0,
    toolNames: [],
    transport: 'http',
    ...partial
  }
}

describe('isSettledMcpStatus', () => {
  it('is false for an absent status', () => {
    expect(isSettledMcpStatus(undefined)).toBe(false)
  })

  it('is false while the server is still connecting', () => {
    expect(isSettledMcpStatus(status({ connecting: true }))).toBe(false)
  })

  it('is true once connected', () => {
    expect(isSettledMcpStatus(status({ connected: true, toolCount: 3 }))).toBe(true)
  })

  it('is true when the server needs auth (even if still marked connecting)', () => {
    expect(isSettledMcpStatus(status({ connecting: true, needsAuth: true }))).toBe(true)
  })

  it('is true on error', () => {
    expect(isSettledMcpStatus(status({ connecting: true, error: 'boom' }))).toBe(true)
  })

  it('is true when the last auth was cancelled', () => {
    expect(isSettledMcpStatus(status({ cancelled: true }))).toBe(true)
  })

  it('is true for an idle not-connected status', () => {
    expect(isSettledMcpStatus(status({}))).toBe(true)
  })
})

describe('syntheticMcpFailureStatus', () => {
  it('infers http transport from a url config', () => {
    const info = syntheticMcpFailureStatus('gh', { url: 'https://example.com/mcp' }, 'timed out')
    expect(info).toEqual({
      name: 'gh',
      connected: false,
      toolCount: 0,
      toolNames: [],
      transport: 'http',
      error: 'timed out'
    })
  })

  it('infers stdio transport when there is no url', () => {
    const info = syntheticMcpFailureStatus('local', {}, 'host exited')
    expect(info.transport).toBe('stdio')
    expect(info.connected).toBe(false)
    expect(info.error).toBe('host exited')
  })
})
