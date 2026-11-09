/** Tests for the self-verification guidance builder and value resolution. */
import { describe, expect, it } from 'vitest'
import { buildVerificationGuidance, resolveVerifyWork } from './verification'

describe('buildVerificationGuidance', () => {
  it('describes discovering and running project checks', () => {
    const text = buildVerificationGuidance({ browser: false })
    expect(text).toContain('package.json scripts')
    expect(text).toContain('separate command')
    expect(text).toContain('Never claim a task is complete')
  })

  it('caps fix cycles and requires honest reporting', () => {
    const text = buildVerificationGuidance({ browser: false })
    expect(text).toContain('2 fix attempts')
    expect(text).toContain('honestly')
  })

  it('includes the browser smoke test only when browser tools exist', () => {
    expect(buildVerificationGuidance({ browser: false })).not.toContain('browser tools')
    expect(buildVerificationGuidance({ browser: true })).toContain('browser tools')
  })

  it('is deterministic for each variant (prefix-cache friendly)', () => {
    expect(buildVerificationGuidance({ browser: true })).toBe(
      buildVerificationGuidance({ browser: true })
    )
    expect(buildVerificationGuidance({ browser: false })).toBe(
      buildVerificationGuidance({ browser: false })
    )
  })
})

describe('resolveVerifyWork', () => {
  it('uses the subchat override when set', () => {
    expect(resolveVerifyWork(true, false)).toBe(true)
    expect(resolveVerifyWork(false, true)).toBe(false)
  })

  it('falls back to the global value when the override is unset', () => {
    expect(resolveVerifyWork(null, true)).toBe(true)
    expect(resolveVerifyWork(undefined, true)).toBe(true)
    expect(resolveVerifyWork(null, false)).toBe(false)
  })

  it('treats absent/non-boolean globals as off (opt-in feature)', () => {
    expect(resolveVerifyWork(null, undefined)).toBe(false)
    expect(resolveVerifyWork(undefined, 'yes')).toBe(false)
    expect(resolveVerifyWork(null, 1)).toBe(false)
  })
})
