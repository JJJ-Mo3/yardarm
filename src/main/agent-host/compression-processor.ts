/**
 * Stateful wrapper turning the pure compressPrompt core into a mastracode
 * input processor (@mastra/core Processor with only id + processLLMRequest —
 * a valid InputProcessor union member). The prompt rewrite is transient: it
 * affects only what is sent to the provider on each call, never the stored
 * thread history. Savings are accumulated per host and reported via onStats
 * at most once per LLM step.
 */

import { compressPrompt, type CompressiblePromptMessage } from './prompt-compression'

export interface CompressionProcessorOptions {
  enabled: boolean
  /** Token estimator (SDK tokenEstimate or chars/4 fallback). */
  estimate: (text: string) => number
  /** Called with the cumulative tokens saved whenever a prompt was compressed. */
  onStats: (tokensSaved: number) => void
}

export interface CompressionProcessor {
  /** Pass to createMastraCode({ inputProcessors: [processor] }). */
  processor: {
    id: string
    processLLMRequest: (args: {
      prompt: CompressiblePromptMessage[]
    }) => { prompt: CompressiblePromptMessage[] } | undefined
  }
  setEnabled: (enabled: boolean) => void
  tokensSaved: () => number
}

export function createCompressionProcessor(
  opts: CompressionProcessorOptions
): CompressionProcessor {
  let enabled = opts.enabled
  let cumulative = 0
  return {
    processor: {
      id: 'yardarm-compression',
      processLLMRequest: ({ prompt }) => {
        if (!enabled || !Array.isArray(prompt)) return undefined
        const result = compressPrompt(prompt, { estimate: opts.estimate })
        if (!result.changed) return undefined
        cumulative += result.tokensSaved
        try {
          opts.onStats(cumulative)
        } catch {}
        return { prompt: result.prompt }
      }
    },
    setEnabled: (value) => {
      enabled = value
    },
    tokensSaved: () => cumulative
  }
}
