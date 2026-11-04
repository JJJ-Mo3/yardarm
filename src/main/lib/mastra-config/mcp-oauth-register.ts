/**
 * RFC 7591 dynamic client registration for connector OAuth sign-ins.
 *
 * The bundled mastracode runtime no longer registers OAuth clients: for
 * zero-config url servers it always identifies with a client-ID-metadata-
 * document URL (CIMD, https://code.mastra.ai/.well-known/oauth-client/...).
 * Authorization servers that don't support URL client IDs (Supabase, GitLab,
 * Netlify — verified Nov 2026) reject that client_id on the authorize page
 * itself, so the browser opens an HTTP 400/401 error page instead of the
 * sign-in screen. The SDK does honor a pre-registered client pinned in the
 * server's mcp.json entry (`oauth.clientId` / `oauth.clientSecret`), so
 * before connecting Yardarm discovers the server's authorization-server
 * metadata and — when CIMD isn't advertised but a registration_endpoint is —
 * registers a public client and pins it. Best-effort throughout: any
 * discovery or registration failure returns the config unchanged (the same
 * reference), leaving the runtime's stock CIMD flow to run.
 *
 * Uses the npm undici fetch: Node's native fetch mis-decodes some providers'
 * compressed well-known responses (observed on Netlify/Vercel/Sentry).
 */
import { fetch as undiciFetch } from 'undici'
import type { McpServerConfig } from './mcp-json'

/** Minimal fetch surface so tests can inject a fake without undici types. */
export type JsonFetch = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  }
) => Promise<{ ok: boolean; json(): Promise<unknown> }>

const defaultFetch: JsonFetch = (url, init) =>
  undiciFetch(url, init) as unknown as ReturnType<JsonFetch>

/**
 * Loopback callback ports the SDK's OAuth flow may bind (1458 plus fallbacks
 * when busy) — mirrors the runtime's candidate list and the CIMD document, so
 * whichever port the callback server lands on is a registered redirect URI.
 */
const CALLBACK_PORTS = [1458, 1459, 1460, 1461, 1462, 1463, 1464, 1465, 1466, 1467, 1468]

export const OAUTH_REDIRECT_URIS = CALLBACK_PORTS.map(
  (port) => `http://127.0.0.1:${port}/oauth/callback`
)

const REQUEST_TIMEOUT_MS = 10_000

type JsonObject = Record<string, unknown>

async function fetchJson(fetchFn: JsonFetch, url: string): Promise<JsonObject | null> {
  try {
    const res = await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as JsonObject) : null
  } catch {
    return null
  }
}

/**
 * Discover the authorization server's metadata for an MCP server URL:
 * RFC 9728 protected-resource metadata names the authorization server (else
 * the MCP origin itself), then RFC 8414 / OIDC well-known lookups on it.
 * Returns null when no candidate yields metadata with authorization_endpoint.
 */
async function discoverAuthServerMetadata(
  fetchFn: JsonFetch,
  serverUrl: URL
): Promise<JsonObject | null> {
  const resourcePath = serverUrl.pathname === '/' ? '' : serverUrl.pathname.replace(/\/$/, '')
  let authServer = new URL('/', serverUrl)
  for (const candidate of [
    ...(resourcePath ? [`/.well-known/oauth-protected-resource${resourcePath}`] : []),
    '/.well-known/oauth-protected-resource'
  ]) {
    const meta = await fetchJson(fetchFn, new URL(candidate, serverUrl).href)
    if (!meta) continue
    const servers = meta.authorization_servers
    const first = Array.isArray(servers) ? servers[0] : undefined
    if (typeof first === 'string') {
      try {
        authServer = new URL(first)
      } catch {}
    }
    break
  }
  const asPath = authServer.pathname === '/' ? '' : authServer.pathname.replace(/\/$/, '')
  const candidates = [
    ...new Set([
      `/.well-known/oauth-authorization-server${asPath}`,
      '/.well-known/oauth-authorization-server',
      `/.well-known/openid-configuration${asPath}`,
      `${asPath}/.well-known/openid-configuration`
    ])
  ]
  for (const candidate of candidates) {
    const meta = await fetchJson(fetchFn, new URL(candidate, authServer).href)
    if (meta && typeof meta.authorization_endpoint === 'string') return meta
  }
  return null
}

async function registerClient(
  fetchFn: JsonFetch,
  registrationEndpoint: string
): Promise<{ clientId: string; clientSecret?: string } | null> {
  try {
    const res = await fetchFn(registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Yardarm',
        redirect_uris: OAUTH_REDIRECT_URIS,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const data = (await res.json()) as JsonObject
    const clientId = data?.client_id
    if (typeof clientId !== 'string' || !clientId) return null
    const clientSecret = data.client_secret
    return {
      clientId,
      ...(typeof clientSecret === 'string' && clientSecret ? { clientSecret } : {})
    }
  } catch {
    return null
  }
}

function hasAuthorizationHeader(config: McpServerConfig): boolean {
  return Object.keys(config.headers ?? {}).some((h) => h.toLowerCase() === 'authorization')
}

/**
 * Return `config` with a freshly registered OAuth client pinned in
 * `oauth.clientId` (+`clientSecret` when issued) when the server's
 * authorization server needs one — i.e. it does not advertise
 * client_id_metadata_document_supported but does offer a
 * registration_endpoint. Returns the *same reference* unchanged for
 * non-OAuth configs (stdio, token headers, already-pinned clientId), for
 * CIMD-capable servers, and on any discovery/registration failure.
 */
export async function withRegisteredOAuthClient(
  config: McpServerConfig,
  fetchFn: JsonFetch = defaultFetch
): Promise<McpServerConfig> {
  if (!config.url || config.command || hasAuthorizationHeader(config)) return config
  const oauth =
    config.oauth && typeof config.oauth === 'object' ? (config.oauth as JsonObject) : undefined
  if (typeof oauth?.clientId === 'string' && oauth.clientId) return config
  let serverUrl: URL
  try {
    serverUrl = new URL(config.url)
  } catch {
    return config
  }
  if (serverUrl.protocol !== 'https:' && serverUrl.protocol !== 'http:') return config
  const meta = await discoverAuthServerMetadata(fetchFn, serverUrl)
  if (!meta) return config
  // URL client IDs work there — leave the runtime's stock CIMD flow alone.
  if (meta.client_id_metadata_document_supported === true) return config
  const registrationEndpoint = meta.registration_endpoint
  if (typeof registrationEndpoint !== 'string' || !registrationEndpoint) return config
  const registered = await registerClient(fetchFn, registrationEndpoint)
  if (!registered) return config
  return { ...config, oauth: { ...oauth, ...registered } }
}
