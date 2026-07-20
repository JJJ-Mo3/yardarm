/**
 * Appends actionable guidance to the SDK's "maximum output length" error.
 *
 * When a model returns finish_reason "length", the SDK surfaces "The model
 * stopped because it reached its maximum output length before finishing."
 * With local servers this means the conversation filled the server-side
 * context window: the agent's base prompt alone is ~30k tokens and every
 * tool result accumulates, and the SDK has no client-side compaction for
 * custom providers — so the only remedies are a bigger window or a fresh
 * chat. Nothing in Yardarm or the SDK sets an output cap, and the context
 * length can only be raised on the server, so the best we can do is tell
 * the user exactly how.
 */
const MAX_OUTPUT_MARKER = 'maximum output length'

const HINT =
  'If this model runs on a local server, the conversation has likely filled its context ' +
  "window. The agent's base prompt alone is ~30k tokens, so the window must be at least 64k " +
  '— 128k or more if your machine has the memory. For Ollama, set it in the app ' +
  '(Settings → Context length) or start the server with OLLAMA_CONTEXT_LENGTH=65536; in ' +
  'LM Studio, set the context length when loading the model; for llama.cpp, use -c. ' +
  'Long sessions grow without bound, so starting a new chat also frees up context.'

export function withMaxOutputHint(text: string): string {
  if (!text.toLowerCase().includes(MAX_OUTPUT_MARKER)) return text
  if (text.includes(HINT)) return text
  return `${text}\n\n${HINT}`
}
