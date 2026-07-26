/**
 * Stateful wrapper turning the pure compressPrompt core into a mastracode
 * input processor (@mastra/core Processor with only id + processLLMRequest —
 * a valid InputProcessor union member). The prompt rewrite is transient: it
 * affects only what is sent to the provider on each call, never the stored
 * thread history. Savings are accumulated per host and reported via onStats
 * at most once per LLM step; rewritten originals are reported via onOriginals
 * so the host can serve them back through retrieve_full_output. Verbosity
 * steering (independent switch) appends a constant terseness suffix to the
 * system message.
 */

import {
  applyVerbositySteering,
  compressPrompt,
  type CompressedOriginal,
  type CompressiblePromptMessage
} from './prompt-compression'

export interface CompressionProcessorOptions {
  enabled: boolean
  verbosity: boolean
  /** Token estimator (SDK tokenEstimate or chars/4 fallback). */
  estimate: (text: string) => number
  /** Called with the cumulative tokens saved whenever a prompt was compressed. */
  onStats: (tokensSaved: number) => void
  /** Called with the originals of every rewritten tool result. */
  onOriginals: (originals: CompressedOriginal[]) => void
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
  setVerbosity: (verbosity: boolean) => void
  tokensSaved: () => number
}

export function createCompressionProcessor(
  opts: CompressionProcessorOptions
): CompressionProcessor {
  let enabled = opts.enabled
  let verbosity = opts.verbosity
  let cumulative = 0
  return {
    processor: {
      id: 'yardarm-compression',
      processLLMRequest: ({ prompt }) => {
        if (!Array.isArray(prompt)) return undefined
        let out = prompt
        if (enabled) {
          const result = compressPrompt(out, { estimate: opts.estimate })
          if (result.changed) {
            out = result.prompt
            cumulative += result.tokensSaved
            try {
              opts.onStats(cumulative)
            } catch {}
            if (result.originals.length) {
              try {
                opts.onOriginals(result.originals)
              } catch {}
            }
          }
        }
        if (verbosity) out = applyVerbositySteering(out).prompt
        if (out === prompt) return undefined
        return { prompt: out }
      }
    },
    setEnabled: (value) => {
      enabled = value
    },
    setVerbosity: (value) => {
      verbosity = value
    },
    tokensSaved: () => cumulative
  }
}
