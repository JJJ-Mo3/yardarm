/**
 * Pure repo-forge detection from a git remote URL. Kept free of Electron/DB
 * imports so it can be unit-tested (forge.ts wraps it with override + CLI
 * resolution).
 */
import type { RepoProvider } from '../../../shared/ipc-types'

/** Provider for a remote URL by hostname, or null when the host reveals neither. */
export function detectForgeFromRemoteUrl(url: string): RepoProvider | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  let host: string | null = null
  // https://host/path or ssh://[user@]host[:port]/path
  const schemed = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]+@)?([^/:]+)/i.exec(trimmed)
  if (schemed) host = schemed[1]
  else {
    // scp-like: git@host:path
    const scp = /^(?:[^@\s]+@)([^/:]+):/.exec(trimmed)
    if (scp) host = scp[1]
  }
  if (!host) return null
  host = host.toLowerCase()
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github'
  if (host === 'gitlab.com' || host.startsWith('gitlab.') || host.includes('.gitlab.')) {
    return 'gitlab'
  }
  return null
}
