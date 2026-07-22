import { describe, expect, it } from 'vitest'
import { isPrefillError, withPrefillHint } from './prefill-error'

const PROVIDER_ERROR =
  'This model does not support assistant message prefill. The conversation must end with a user message.'

describe('isPrefillError', () => {
  it('matches the provider prefill rejection', () => {
    expect(isPrefillError(PROVIDER_ERROR)).toBe(true)
  })

  it('matches the enable_thinking prefill variant', () => {
    expect(isPrefillError('assistant response prefill is incompatible with enable_thinking')).toBe(
      true
    )
    expect(
      isPrefillError('Assistant response prefill is incompatible with enable-thinking mode')
    ).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isPrefillError('rate limit exceeded')).toBe(false)
    expect(isPrefillError('The model stopped because it reached its maximum output length')).toBe(
      false
    )
  })
})

describe('withPrefillHint', () => {
  it('appends the manual remedy to prefill errors', () => {
    const out = withPrefillHint(PROVIDER_ERROR)
    expect(out).toContain(PROVIDER_ERROR)
    expect(out).toContain('Send any message')
  })

  it('is idempotent', () => {
    const once = withPrefillHint(PROVIDER_ERROR)
    expect(withPrefillHint(once)).toBe(once)
  })

  it('leaves other errors untouched', () => {
    expect(withPrefillHint('boom')).toBe('boom')
  })
})
