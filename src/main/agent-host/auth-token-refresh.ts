/**
 * Coordinated OAuth token refresh for the SDK's AuthStorage.
 *
 * The SDK refreshes OAuth tokens lazily inside `getApiKey` and swallows every
 * refresh failure (`catch { return undefined }`), which callers surface as
 * "Not logged in — run /login first". Refresh tokens rotate on every use, so
 * with one long-lived agent-host per subchat (plus the CLI tab) all sharing
 * auth.json, an idle-expired token triggers a refresh stampede on wake: the
 * losers burn an already-rotated refresh token (invalid_grant), and replay
 * detection can revoke the winner's token family too — a genuine logout.
 *
 * This wrapper patches `authStorage.getApiKey` (the per-process singleton
 * every provider's OAuth fetch uses) so that expired-token refreshes are:
 *  - serialized in-process per provider (concurrent fetches share one refresh)
 *  - guarded by a cross-process lock directory next to auth.json
 *  - preceded by a reload-and-recheck, so a token another process already
 *    refreshed is picked up from disk instead of re-refreshing
 *  - retried once after a short delay for transient failures (network blips
 *    right after machine wake), with loud logs on final failure
 *
 * `refreshExpiringSoon` runs the same coordinated path for any stored OAuth
 * credential past its SDK expiry timestamp; the host calls it on boot and on
 * an interval so tokens are renewed while idle rather than at send time.
 * (The SDK's stored `expires` already sits 5 minutes before the real expiry,
 * so an interval-driven refresh shortly after it still beats the provider.)
 */
import { mkdirSync, rmdirSync, statSync } from 'fs'

/** Shape of the SDK AuthStorage internals this module relies on. */
export interface AuthStorageLike {
  reload(): void
  get(provider: string): { type: string; expires?: number } | undefined
  list(): string[]
  getApiKey(providerId: string): Promise<string | undefined>
}

export interface CoordinatedRefreshOptions {
  /** Path to auth.json; the lock directory is created next to it. */
  authPath?: string
  /** Give up waiting for another process's lock after this long. */
  lockTimeoutMs?: number
  /** Consider a held lock abandoned (crashed process) after this long. */
  lockStaleMs?: number
  /** Poll cadence while waiting for the lock. */
  lockPollMs?: number
  /** Delay before the single retry after a failed refresh. */
  retryDelayMs?: number
  log?: (level: 'info' | 'error', msg: string) => void
}

/** Cadence for the host's keep-fresh interval. */
export const KEEP_FRESH_INTERVAL_MS = 2 * 60_000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function isExpiredOAuth(cred: { type: string; expires?: number } | undefined): boolean {
  return cred?.type === 'oauth' && typeof cred.expires === 'number' && Date.now() >= cred.expires
}

/**
 * Patches `storage.getApiKey` with the coordinated refresh path and returns
 * the keep-fresh entry point. Install once per process, right after boot.
 */
export function installCoordinatedTokenRefresh(
  storage: AuthStorageLike,
  options: CoordinatedRefreshOptions = {}
): { refreshExpiringSoon(): Promise<void> } {
  const {
    authPath,
    lockTimeoutMs = 45_000,
    lockStaleMs = 60_000,
    lockPollMs = 250,
    retryDelayMs = 2_000,
    log
  } = options
  const lockDir = authPath ? `${authPath}.refresh-lock` : undefined
  const original = storage.getApiKey.bind(storage)
  /** Per-provider promise chains serializing refreshes within this process. */
  const chains = new Map<string, Promise<unknown>>()

  /**
   * Best-effort cross-process lock via atomic mkdir. Returns whether we hold
   * the lock; on timeout or filesystem trouble we proceed unlocked rather
   * than deadlock auth entirely.
   */
  const acquireLock = async (dir: string): Promise<boolean> => {
    const deadline = Date.now() + lockTimeoutMs
    for (;;) {
      try {
        mkdirSync(dir)
        return true
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false
      }
      try {
        const st = statSync(dir)
        if (Date.now() - st.mtimeMs > lockStaleMs) {
          try {
            rmdirSync(dir)
          } catch {}
        }
      } catch {}
      if (Date.now() >= deadline) return false
      await sleep(lockPollMs)
    }
  }

  const refreshUnderLock = async (providerId: string): Promise<string | undefined> => {
    const locked = lockDir ? await acquireLock(lockDir) : false
    try {
      // Another process may have refreshed while we waited — its rotated
      // token is on disk and ours would be invalid, so always re-read first.
      storage.reload()
      if (!isExpiredOAuth(storage.get(providerId))) return original(providerId)
      let token = await original(providerId)
      if (token === undefined && storage.get(providerId)?.type === 'oauth') {
        log?.('error', `oauth refresh failed for ${providerId}; retrying once`)
        await sleep(retryDelayMs)
        storage.reload()
        token = await original(providerId)
        if (token === undefined) {
          log?.('error', `oauth refresh retry failed for ${providerId} — /login required`)
        }
      }
      return token
    } finally {
      if (locked && lockDir) {
        try {
          rmdirSync(lockDir)
        } catch {}
      }
    }
  }

  const coordinated = (providerId: string): Promise<string | undefined> => {
    if (!isExpiredOAuth(storage.get(providerId))) return original(providerId)
    const prev = chains.get(providerId) ?? Promise.resolve()
    const run = prev.then(
      () => refreshUnderLock(providerId),
      () => refreshUnderLock(providerId)
    )
    chains.set(
      providerId,
      run.catch(() => undefined)
    )
    return run
  }

  storage.getApiKey = coordinated

  return {
    async refreshExpiringSoon(): Promise<void> {
      try {
        storage.reload()
      } catch {
        return
      }
      for (const providerId of storage.list()) {
        if (!isExpiredOAuth(storage.get(providerId))) continue
        try {
          await coordinated(providerId)
        } catch {}
      }
    }
  }
}
