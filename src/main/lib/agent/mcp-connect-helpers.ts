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
export function isSettledMcpStatus(info: McpServerStatusInfo | undefined): boolean {
  if (!info) return false
  return Boolean(
    info.connected || info.needsAuth || info.error || info.cancelled || !info.connecting
  )
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
