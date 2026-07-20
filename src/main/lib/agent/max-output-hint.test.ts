/** Tests for the "maximum output length" error hint helper. */
import { describe, expect, it } from 'vitest'
import { withMaxOutputHint } from './max-output-hint'

const SDK_MESSAGE =
  'The model stopped because it reached its maximum output length before finishing.'

describe('withMaxOutputHint', () => {
  it('appends local-server context guidance to the max-output-length error', () => {
    const result = withMaxOutputHint(SDK_MESSAGE)
    expect(result.startsWith(SDK_MESSAGE)).toBe(true)
    expect(result).toContain('OLLAMA_CONTEXT_LENGTH')
    expect(result).toContain('LM Studio')
  })

  it('matches case-insensitively', () => {
    expect(withMaxOutputHint('Reached its MAXIMUM OUTPUT LENGTH')).toContain(
      'OLLAMA_CONTEXT_LENGTH'
    )
  })

  it('leaves unrelated errors untouched', () => {
    expect(withMaxOutputHint('terminated')).toBe('terminated')
    expect(withMaxOutputHint('Unknown agent error')).toBe('Unknown agent error')
  })

  it('does not double-append the hint', () => {
    const once = withMaxOutputHint(SDK_MESSAGE)
    expect(withMaxOutputHint(once)).toBe(once)
  })
})
