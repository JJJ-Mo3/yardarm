/**
 * Tests for the coordinated OAuth token refresh wrapper: single refresh under
 * concurrency, cross-process pickup via reload, stale-lock takeover, retry on
 * transient failure, and the keep-fresh sweep.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { installCoordinatedTokenRefresh, type AuthStorageLike } from './auth-token-refresh'

type Cred = { type: string; access?: string; expires?: number; key?: string }

/**
 * Mimics the SDK AuthStorage: in-memory view of an on-disk store, and a
 * getApiKey that lazily refreshes expired OAuth creds, swallowing failures.
 */
class FakeStorage implements AuthStorageLike {
  disk: Record<string, Cred> = {}
  data: Record<string, Cred> = {}
  refreshCalls = 0
  failNextRefreshes = 0

  reload(): void {
    this.data = structuredClone(this.disk)
  }

  get(provider: string): Cred | undefined {
    return this.data[provider]
  }

  list(): string[] {
    return Object.keys(this.data)
  }

  async getApiKey(providerId: string): Promise<string | undefined> {
    const cred = this.data[providerId]
    if (cred?.type === 'api_key') return cred.key
    if (cred?.type !== 'oauth') return undefined
    if (Date.now() >= (cred.expires ?? 0)) {
      this.refreshCalls++
      if (this.failNextRefreshes > 0) {
        this.failNextRefreshes--
        return undefined
      }
      const fresh: Cred = {
        type: 'oauth',
        access: `token-${this.refreshCalls}`,
        expires: Date.now() + 3_600_000
      }
      this.data[providerId] = fresh
      this.disk[providerId] = structuredClone(fresh)
      return fresh.access
    }
    return cred.access
  }
}

function expiredStorage(): FakeStorage {
  const s = new FakeStorage()
  s.disk.anthropic = { type: 'oauth', access: 'stale', expires: Date.now() - 1000 }
  s.reload()
  return s
}

const tempDirs: string[] = []
function tempAuthPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yardarm-auth-test-'))
  tempDirs.push(dir)
  return join(dir, 'auth.json')
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('installCoordinatedTokenRefresh', () => {
  it('passes unexpired oauth and api-key creds straight through', async () => {
    const s = new FakeStorage()
    s.disk.anthropic = { type: 'oauth', access: 'live', expires: Date.now() + 3_600_000 }
    s.disk['apikey:openai'] = { type: 'api_key', key: 'sk-1' }
    s.reload()
    installCoordinatedTokenRefresh(s)
    expect(await s.getApiKey('anthropic')).toBe('live')
    expect(await s.getApiKey('apikey:openai')).toBe('sk-1')
    expect(s.refreshCalls).toBe(0)
  })

  it('refreshes an expired token exactly once for concurrent callers', async () => {
    const s = expiredStorage()
    installCoordinatedTokenRefresh(s, { authPath: tempAuthPath() })
    const tokens = await Promise.all([
      s.getApiKey('anthropic'),
      s.getApiKey('anthropic'),
      s.getApiKey('anthropic')
    ])
    expect(tokens).toEqual(['token-1', 'token-1', 'token-1'])
    expect(s.refreshCalls).toBe(1)
  })

  it('uses a token another process already refreshed instead of refreshing', async () => {
    const s = expiredStorage()
    installCoordinatedTokenRefresh(s, { authPath: tempAuthPath() })
    // "Another process" rotated the credential on disk after our load.
    s.disk.anthropic = { type: 'oauth', access: 'other-proc', expires: Date.now() + 3_600_000 }
    expect(await s.getApiKey('anthropic')).toBe('other-proc')
    expect(s.refreshCalls).toBe(0)
  })

  it('waits for a held lock and picks up the fresh token afterwards', async () => {
    const s = expiredStorage()
    const authPath = tempAuthPath()
    const lockDir = `${authPath}.refresh-lock`
    mkdirSync(lockDir)
    installCoordinatedTokenRefresh(s, { authPath, lockPollMs: 10, lockStaleMs: 60_000 })
    const pending = s.getApiKey('anthropic')
    // The "other process" finishes its refresh and releases the lock.
    await new Promise((r) => setTimeout(r, 30))
    s.disk.anthropic = {
      type: 'oauth',
      access: 'from-lock-holder',
      expires: Date.now() + 3_600_000
    }
    rmSync(lockDir, { recursive: true })
    expect(await pending).toBe('from-lock-holder')
    expect(s.refreshCalls).toBe(0)
  })

  it('takes over a stale lock left by a crashed process', async () => {
    const s = expiredStorage()
    const authPath = tempAuthPath()
    const lockDir = `${authPath}.refresh-lock`
    mkdirSync(lockDir)
    const old = new Date(Date.now() - 120_000)
    utimesSync(lockDir, old, old)
    installCoordinatedTokenRefresh(s, { authPath, lockPollMs: 10, lockStaleMs: 1_000 })
    expect(await s.getApiKey('anthropic')).toBe('token-1')
    expect(s.refreshCalls).toBe(1)
  })

  it('retries once after a transient refresh failure', async () => {
    const s = expiredStorage()
    s.failNextRefreshes = 1
    const logs: string[] = []
    installCoordinatedTokenRefresh(s, {
      authPath: tempAuthPath(),
      retryDelayMs: 10,
      log: (_level, msg) => logs.push(msg)
    })
    expect(await s.getApiKey('anthropic')).toBe('token-2')
    expect(s.refreshCalls).toBe(2)
    expect(logs.some((m) => m.includes('retrying once'))).toBe(true)
  })

  it('returns undefined and logs when the retry also fails', async () => {
    const s = expiredStorage()
    s.failNextRefreshes = 2
    const logs: string[] = []
    installCoordinatedTokenRefresh(s, {
      authPath: tempAuthPath(),
      retryDelayMs: 10,
      log: (_level, msg) => logs.push(msg)
    })
    expect(await s.getApiKey('anthropic')).toBeUndefined()
    expect(logs.some((m) => m.includes('/login required'))).toBe(true)
    // A later call sees the still-expired cred and tries again (not latched).
    expect(await s.getApiKey('anthropic')).toBe('token-3')
  })

  it('refreshExpiringSoon renews expired oauth creds and skips the rest', async () => {
    const s = new FakeStorage()
    s.disk.anthropic = { type: 'oauth', access: 'stale', expires: Date.now() - 1000 }
    s.disk.xai = { type: 'oauth', access: 'live', expires: Date.now() + 3_600_000 }
    s.disk['apikey:openai'] = { type: 'api_key', key: 'sk-1' }
    s.reload()
    const refresh = installCoordinatedTokenRefresh(s, { authPath: tempAuthPath() })
    await refresh.refreshExpiringSoon()
    expect(s.refreshCalls).toBe(1)
    expect(await s.getApiKey('anthropic')).toBe('token-1')
    expect(await s.getApiKey('xai')).toBe('live')
  })
})
