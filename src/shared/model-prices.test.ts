import { describe, expect, it } from 'vitest'
import { estimateCostUSD, findModelPrice } from './model-prices'

describe('findModelPrice', () => {
  it('matches by bare-id prefix after stripping the provider', () => {
    expect(findModelPrice('anthropic/claude-sonnet-4-5')).toEqual({ input: 3, output: 15 })
    expect(findModelPrice('claude-haiku-4-5')).toEqual({ input: 1, output: 5 })
  })

  it('prefers more specific prefixes', () => {
    expect(findModelPrice('openai/gpt-5-mini')).toEqual({ input: 0.25, output: 2 })
    expect(findModelPrice('openai/gpt-5')).toEqual({ input: 1.25, output: 10 })
  })

  it('treats local providers as free', () => {
    expect(findModelPrice('ollama/qwen3.6:27b')).toEqual({ input: 0, output: 0 })
  })

  it('returns null for unknown models', () => {
    expect(findModelPrice('mystery/model-x')).toBeNull()
  })
})

describe('estimateCostUSD', () => {
  it('computes cost from input/output token totals', () => {
    expect(
      estimateCostUSD('anthropic/claude-sonnet-4-5', {
        inputTokens: 2_000_000,
        outputTokens: 1_000_000
      })
    ).toBeCloseTo(21)
  })

  it('returns null for unknown models', () => {
    expect(estimateCostUSD('mystery/model-x', { inputTokens: 100 })).toBeNull()
  })
})
