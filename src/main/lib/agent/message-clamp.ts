/**
 * Clamp message parts before writing to SQLite so single rows can't grow
 * unboundedly (huge shell output, multi-MB tool results, etc). The live
 * streaming UI keeps full content in memory — only what is persisted (and
 * re-loaded after restart) is clamped.
 */
import type { MessagePart, StoredMessage, ToolCallPart } from '../../../shared/ui-message'

const OUTPUT_TEXT_LIMIT = 96 * 1024
const RESULT_LIMIT = 96 * 1024
const ARGS_LIMIT = 32 * 1024
const TEXT_LIMIT = 256 * 1024

/** Head+tail elision keeping roughly `limit` characters. */
function elide(text: string, limit: number): string {
  if (text.length <= limit) return text
  const half = Math.floor(limit / 2)
  const cutKb = Math.round((text.length - limit) / 1024)
  return `${text.slice(0, half)}\n… [truncated ${cutKb} KB] …\n${text.slice(-half)}`
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null
  } catch {
    return null
  }
}

/** Replace an oversized JSON value with a small truncation marker. */
function clampJsonValue(value: unknown, limit: number): { value: unknown; changed: boolean } {
  const serialized = safeStringify(value)
  if (serialized === null || serialized.length <= limit) return { value, changed: false }
  return {
    value: { __truncated: true, preview: elide(serialized, Math.min(limit, 8 * 1024)) },
    changed: true
  }
}

function clampToolCall(part: ToolCallPart): ToolCallPart {
  let changed = false
  let outputText = part.outputText
  if (outputText && outputText.length > OUTPUT_TEXT_LIMIT) {
    outputText = elide(outputText, OUTPUT_TEXT_LIMIT)
    changed = true
  }
  const result = clampJsonValue(part.result, RESULT_LIMIT)
  const args = clampJsonValue(part.args, ARGS_LIMIT)
  if (result.changed || args.changed) changed = true
  if (!changed) return part
  return { ...part, outputText, result: result.value, args: args.value }
}

function clampPart(part: MessagePart): MessagePart {
  switch (part.type) {
    case 'tool-call':
      return clampToolCall(part)
    case 'text':
    case 'reasoning':
      if (part.text.length > TEXT_LIMIT) return { ...part, text: elide(part.text, TEXT_LIMIT) }
      return part
    default:
      return part
  }
}

/**
 * Returns the same reference when nothing exceeds limits; otherwise a copy
 * with oversized parts elided/replaced.
 */
export function clampMessageForStorage(message: StoredMessage): StoredMessage {
  let changed = false
  const parts = message.parts.map((part) => {
    const clamped = clampPart(part)
    if (clamped !== part) changed = true
    return clamped
  })
  if (!changed) return message
  return { ...message, parts }
}
