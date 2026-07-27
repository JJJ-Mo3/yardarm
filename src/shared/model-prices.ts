/**
 * Rough, static price estimates (USD per million tokens) for common hosted
 * models, matched by model-id prefix. Used only for the "estimated cost"
 * figures in the Analytics tab — unknown models show token counts without a
 * cost, and local providers (ollama, LM Studio, llama.cpp) count as free.
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
}

const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'llamacpp', 'llama-cpp', 'local']

/** Ordered most-specific-first; matched with startsWith on the bare id. */
const PRICES: Array<[string, ModelPrice]> = [
  ['claude-opus-4-1', { input: 15, output: 75 }],
  ['claude-opus', { input: 5, output: 25 }],
  ['claude-sonnet', { input: 3, output: 15 }],
  ['claude-haiku', { input: 1, output: 5 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4 }],
  ['gpt-5-mini', { input: 0.25, output: 2 }],
  ['gpt-5-nano', { input: 0.05, output: 0.4 }],
  ['gpt-5', { input: 1.25, output: 10 }],
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6 }],
  ['gpt-4.1-nano', { input: 0.1, output: 0.4 }],
  ['gpt-4.1', { input: 2, output: 8 }],
  ['o4-mini', { input: 1.1, output: 4.4 }],
  ['o3-mini', { input: 1.1, output: 4.4 }],
  ['o3', { input: 2, output: 8 }],
  ['gemini-2.5-pro', { input: 1.25, output: 10 }],
  ['gemini-2.5-flash-lite', { input: 0.1, output: 0.4 }],
  ['gemini-2.5-flash', { input: 0.3, output: 2.5 }],
  ['deepseek', { input: 0.27, output: 1.1 }],
  ['grok-3-mini', { input: 0.3, output: 0.5 }],
  ['grok', { input: 3, output: 15 }]
]

/** Estimated price for a model id (e.g. "anthropic/claude-sonnet-4-5"), or null if unknown. */
export function findModelPrice(modelId: string): ModelPrice | null {
  const slash = modelId.indexOf('/')
  const provider = slash > 0 ? modelId.slice(0, slash).toLowerCase() : ''
  if (LOCAL_PROVIDERS.includes(provider)) return { input: 0, output: 0 }
  const bare = (slash >= 0 ? modelId.slice(slash + 1) : modelId).toLowerCase()
  for (const [prefix, price] of PRICES) {
    if (bare.startsWith(prefix)) return price
  }
  return null
}

/** Estimated USD cost for a usage total, or null when the model is unknown. */
export function estimateCostUSD(
  modelId: string,
  usage: { inputTokens?: number; outputTokens?: number }
): number | null {
  const price = findModelPrice(modelId)
  if (!price) return null
  return ((usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output) / 1e6
}
