/**
 * Detection and user guidance for provider "assistant message prefill"
 * rejections ("This model does not support assistant message prefill. The
 * conversation must end with a user message.").
 *
 * Some providers — commonly Anthropic-compatible endpoints for non-Anthropic
 * models — reject any request whose conversation ends with an assistant
 * message. The SDK's own PrefillErrorHandler retries once, but when that
 * fails the run dies with the raw provider error. The patterns here mirror
 * the SDK's, so the session manager can auto-send a hidden "continue" user
 * message (which is all the provider actually demands), and the translator
 * can append a manual remedy when auto-recovery isn't possible.
 */
const PREFILL_ERROR_PATTERNS = [
  /does not support assistant message prefill/i,
  /assistant response prefill is incompatible with enable[_\s-]?thinking/i
]

const HINT =
  "This provider can't resume a reply that ends with an assistant message. Send any message " +
  '— e.g. "continue" — to resume, or switch to a model that supports assistant prefill.'

export function isPrefillError(text: string): boolean {
  return PREFILL_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

export function withPrefillHint(text: string): string {
  if (!isPrefillError(text)) return text
  if (text.includes(HINT)) return text
  return `${text}\n\n${HINT}`
}
