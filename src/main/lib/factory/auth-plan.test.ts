/**
 * Tests for the Factory auth-ladder derivation — precedence and the exact
 * `=== '1'` disabled check must mirror the scaffold's src/mastra/index.ts.
 */
import { describe, expect, it } from 'vitest'
import { deriveAuthPlan } from './auth-plan'

describe('deriveAuthPlan', () => {
  it('defaults to platform sign-in when nothing is configured', () => {
    expect(deriveAuthPlan({})).toBe('platform-default')
    expect(deriveAuthPlan({ PORT: '4111' })).toBe('platform-default')
  })

  it('treats only MASTRACODE_AUTH_DISABLED=1 as disabled (scaffold is === "1")', () => {
    expect(deriveAuthPlan({ MASTRACODE_AUTH_DISABLED: '1' })).toBe('disabled')
    expect(deriveAuthPlan({ MASTRACODE_AUTH_DISABLED: '0' })).toBe('platform-default')
    expect(deriveAuthPlan({ MASTRACODE_AUTH_DISABLED: 'true' })).toBe('platform-default')
    expect(deriveAuthPlan({ MASTRACODE_AUTH_DISABLED: '' })).toBe('platform-default')
  })

  it('disabled beats every other configuration', () => {
    expect(
      deriveAuthPlan({
        MASTRACODE_AUTH_DISABLED: '1',
        MASTRA_SHARED_API_URL: 'https://api.example.com',
        WORKOS_API_KEY: 'k',
        WORKOS_CLIENT_ID: 'c'
      })
    ).toBe('disabled')
  })

  it('defers to a shared platform API before WorkOS', () => {
    expect(deriveAuthPlan({ MASTRA_SHARED_API_URL: 'https://api.example.com' })).toBe(
      'platform-deferred'
    )
    expect(
      deriveAuthPlan({
        MASTRA_SHARED_API_URL: 'https://api.example.com',
        WORKOS_API_KEY: 'k',
        WORKOS_CLIENT_ID: 'c'
      })
    ).toBe('platform-deferred')
    expect(deriveAuthPlan({ MASTRA_SHARED_API_URL: '   ' })).toBe('platform-default')
  })

  it('requires BOTH WorkOS keys non-blank', () => {
    expect(deriveAuthPlan({ WORKOS_API_KEY: 'k', WORKOS_CLIENT_ID: 'c' })).toBe('workos')
    expect(deriveAuthPlan({ WORKOS_API_KEY: 'k' })).toBe('platform-default')
    expect(deriveAuthPlan({ WORKOS_CLIENT_ID: 'c' })).toBe('platform-default')
    expect(deriveAuthPlan({ WORKOS_API_KEY: ' ', WORKOS_CLIENT_ID: 'c' })).toBe('platform-default')
  })
})
