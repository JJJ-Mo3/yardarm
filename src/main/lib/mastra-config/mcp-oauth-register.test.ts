/** Tests for RFC 7591 dynamic client registration of connector OAuth clients. */
import { describe, expect, it } from 'vitest'
import {
  OAUTH_REDIRECT_URIS,
  withRegisteredOAuthClient,
  type JsonFetch
} from './mcp-oauth-register'

interface Call {
  url: string
  method: string
  body?: unknown
}

/** Fake fetch: exact-URL routes to JSON payloads; anything else is a 404. */
function fakeFetch(routes: Record<string, unknown>, calls: Call[] = []): JsonFetch {
  return async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body) : undefined
    })
    const hit = Object.prototype.hasOwnProperty.call(routes, url)
    return {
      ok: hit,
      json: async () => (hit ? routes[url] : {})
    }
  }
}

const SERVER_URL = 'https://mcp.example.com/mcp'
const PR_META = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'
const AS_META = 'https://auth.example.com/.well-known/oauth-authorization-server'

const asMetadata = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  ...extra
})

describe('withRegisteredOAuthClient', () => {
  it('registers a client when the AS lacks CIMD support but offers registration', async () => {
    const calls: Call[] = []
    const fetchFn = fakeFetch(
      {
        [PR_META]: { authorization_servers: ['https://auth.example.com'] },
        [AS_META]: asMetadata({ registration_endpoint: 'https://auth.example.com/register' }),
        'https://auth.example.com/register': { client_id: 'abc123', client_secret: 'shh' }
      },
      calls
    )
    const config = { url: SERVER_URL }
    const result = await withRegisteredOAuthClient(config, fetchFn)
    expect(result).not.toBe(config)
    expect(result.oauth).toEqual({ clientId: 'abc123', clientSecret: 'shh' })
    expect(result.url).toBe(SERVER_URL)
    const registration = calls.find((c) => c.method === 'POST')
    expect(registration?.url).toBe('https://auth.example.com/register')
    expect(registration?.body).toMatchObject({
      redirect_uris: OAUTH_REDIRECT_URIS,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    })
  })

  it('omits clientSecret when the server does not issue one', async () => {
    const fetchFn = fakeFetch({
      [PR_META]: { authorization_servers: ['https://auth.example.com'] },
      [AS_META]: asMetadata({ registration_endpoint: 'https://auth.example.com/register' }),
      'https://auth.example.com/register': { client_id: 'abc123' }
    })
    const result = await withRegisteredOAuthClient({ url: SERVER_URL }, fetchFn)
    expect(result.oauth).toEqual({ clientId: 'abc123' })
  })

  it('falls back to the MCP origin as authorization server without resource metadata', async () => {
    const fetchFn = fakeFetch({
      'https://mcp.example.com/.well-known/oauth-authorization-server': asMetadata({
        registration_endpoint: 'https://mcp.example.com/register'
      }),
      'https://mcp.example.com/register': { client_id: 'origin-client' }
    })
    const result = await withRegisteredOAuthClient({ url: SERVER_URL }, fetchFn)
    expect(result.oauth).toEqual({ clientId: 'origin-client' })
  })

  it('leaves CIMD-capable servers alone', async () => {
    const calls: Call[] = []
    const fetchFn = fakeFetch(
      {
        [PR_META]: { authorization_servers: ['https://auth.example.com'] },
        [AS_META]: asMetadata({
          registration_endpoint: 'https://auth.example.com/register',
          client_id_metadata_document_supported: true
        })
      },
      calls
    )
    const config = { url: SERVER_URL }
    expect(await withRegisteredOAuthClient(config, fetchFn)).toBe(config)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('returns the config unchanged when no AS metadata is discoverable', async () => {
    const config = { url: SERVER_URL }
    expect(await withRegisteredOAuthClient(config, fakeFetch({}))).toBe(config)
  })

  it('returns the config unchanged when the AS offers no registration endpoint', async () => {
    const config = { url: SERVER_URL }
    const fetchFn = fakeFetch({
      [PR_META]: { authorization_servers: ['https://auth.example.com'] },
      [AS_META]: asMetadata()
    })
    expect(await withRegisteredOAuthClient(config, fetchFn)).toBe(config)
  })

  it('returns the config unchanged when registration fails', async () => {
    const config = { url: SERVER_URL }
    const fetchFn = fakeFetch({
      [PR_META]: { authorization_servers: ['https://auth.example.com'] },
      [AS_META]: asMetadata({ registration_endpoint: 'https://auth.example.com/register' })
    })
    expect(await withRegisteredOAuthClient(config, fetchFn)).toBe(config)
  })

  it('survives a fetch that rejects', async () => {
    const config = { url: SERVER_URL }
    const rejecting: JsonFetch = async () => {
      throw new Error('network down')
    }
    expect(await withRegisteredOAuthClient(config, rejecting)).toBe(config)
  })

  it('skips stdio, token-header, pinned-client, and invalid-url configs', async () => {
    const neverCalled: JsonFetch = async () => {
      throw new Error('should not fetch')
    }
    const configs: Parameters<typeof withRegisteredOAuthClient>[0][] = [
      { command: 'npx', args: ['-y', '@netlify/mcp'] },
      { url: SERVER_URL, headers: { Authorization: 'Bearer tok' } },
      { url: SERVER_URL, headers: { authorization: 'Bearer tok' } },
      { url: SERVER_URL, oauth: { clientId: 'existing' } },
      { url: 'not a url' }
    ]
    for (const config of configs) {
      expect(await withRegisteredOAuthClient(config, neverCalled)).toBe(config)
    }
  })
})
