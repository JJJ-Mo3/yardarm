/**
 * Pure helpers for the connector connect orchestration in the session
 * manager: deciding when a polled MCP server status is settled, and shaping
 * a uniform failure status when the host never produced one.
 */
import type { McpServerStatusInfo } from '../../../shared/ipc-types'

/**
 * A status is settled once the server has reached a terminal state for the
 * current attempt — connected, awaiting OAuth, errored, or cancelled — or is
 * simply no longer connecting. Absent statuses are never settled.
 */
export function isSettledMcpStatus(
  info: McpServerStatusInfo | undefined
): info is McpServerStatusInfo {
  if (!info) return false
  return Boolean(
    info.connected || info.needsAuth || info.error || info.cancelled || !info.connecting
  )
}

/**
 * The SDK only flags needsAuth when the connect error contains 401,
 * "unauthorized", or "invalid_token" — but auth-required phrasing varies by
 * platform (Netlify says "unauthenticated", GitHub says "missing required
 * Authorization header"; phrasings verified against all six connector
 * platforms, July 2026). Broaden the match so those servers still surface an
 * authenticate path instead of a dead error.
 */
const AUTH_LIKE_ERROR = /\b401\b|unauthorized|unauthenticated|invalid_token|authorization header/i

/**
 * Re-derive needsAuth for an unconnected http server whose error reads like
 * an authentication failure. Statuses the SDK already resolved (connected,
 * needsAuth, non-http, no error) pass through untouched.
 */
export function withNeedsAuthHeuristic(info: McpServerStatusInfo): McpServerStatusInfo {
  if (info.connected || info.needsAuth || info.transport !== 'http' || !info.error) return info
  return AUTH_LIKE_ERROR.test(info.error) ? { ...info, needsAuth: true } : info
}

/**
 * Uniform failure result for connect orchestration paths that never got a
 * real status from the host (boot failure, poll budget exhausted, host died).
 */
export function syntheticMcpFailureStatus(
  name: string,
  config: { url?: string },
  error: string
): McpServerStatusInfo {
  return {
    name,
    connected: false,
    toolCount: 0,
    toolNames: [],
    transport: config.url ? 'http' : 'stdio',
    error
  }
}
