import { describe, expect, it } from 'vitest'
import {
  isSettledMcpStatus,
  syntheticMcpFailureStatus,
  withNeedsAuthHeuristic
} from './mcp-connect-helpers'
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

describe('withNeedsAuthHeuristic', () => {
  // Real connect-error phrasings observed from the six connector platforms
  // (July 2026). The SDK's own regex already catches all but Netlify's and
  // GitHub's; the heuristic must cover those without touching the rest.
  it('flags Netlify "unauthenticated" phrasing', () => {
    const info = withNeedsAuthHeuristic(
      status({ error: 'Error POSTing to endpoint: {"error":"unauthenticated"}' })
    )
    expect(info.needsAuth).toBe(true)
  })

  it('flags GitHub "missing required Authorization header" phrasing', () => {
    const info = withNeedsAuthHeuristic(
      status({ error: 'bad request: missing required Authorization header' })
    )
    expect(info.needsAuth).toBe(true)
  })

  it('flags Supabase/GitLab/Vercel/Sentry-style phrasings', () => {
    for (const error of [
      '{"message":"Unauthorized"}',
      '{"message":"401 Unauthorized"}',
      '{"error":"invalid_token","error_description":"No authorization provided"}',
      '{"error":"invalid_token","error_description":"Missing or invalid access token"}'
    ]) {
      expect(withNeedsAuthHeuristic(status({ error })).needsAuth).toBe(true)
    }
  })

  it('passes through statuses the SDK already resolved', () => {
    const connected = status({ connected: true, toolCount: 2 })
    expect(withNeedsAuthHeuristic(connected)).toBe(connected)
    const flagged = status({ needsAuth: true, error: 'x' })
    expect(withNeedsAuthHeuristic(flagged)).toBe(flagged)
  })

  it('leaves non-auth errors, stdio servers, and errorless statuses alone', () => {
    expect(withNeedsAuthHeuristic(status({ error: 'ECONNREFUSED' })).needsAuth).toBeUndefined()
    expect(
      withNeedsAuthHeuristic(status({ transport: 'stdio', error: '401 unauthorized' })).needsAuth
    ).toBeUndefined()
    expect(withNeedsAuthHeuristic(status({})).needsAuth).toBeUndefined()
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
