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
const INFO_LIMIT = 16 * 1024

// Whole-message budget: per-part limits alone still allow a message with
// dozens of tool calls to reach several MB. Beyond this budget the oldest
// parts are minimized (recent parts are what the user actually revisits).
const TOTAL_PARTS_BUDGET = 1.5 * 1024 * 1024
const RECENT_PARTS_KEPT = 20
const MINIFIED_LIMIT = 4 * 1024
const MINIFIED_JSON_LIMIT = 2 * 1024
const DROPPED_OUTPUT_MARKER = '… [output dropped to fit message storage budget] …'

/**
 * Head+tail elision keeping at most `limit` characters (marker included), so
 * re-clamping an already-elided text is a no-op — clamping must be idempotent
 * because persisted messages can be re-clamped on later writes.
 */
function elide(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cutKb = Math.round((text.length - limit) / 1024)
  const marker = `\n… [truncated ${cutKb} KB] …\n`
  const half = Math.max(0, Math.floor((limit - marker.length) / 2))
  return `${text.slice(0, half)}${marker}${text.slice(-half)}`
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
    case 'info':
      if (part.text.length > INFO_LIMIT) return { ...part, text: elide(part.text, INFO_LIMIT) }
      return part
    default:
      return part
  }
}

function partSize(part: MessagePart): number {
  return safeStringify(part)?.length ?? 0
}

const TRUNCATED_SUFFIX = '\n… [truncated to fit message storage budget]'

/**
 * Deterministic head-only truncation, unlike `elide` whose output length
 * hovers just above the limit and would re-shrink on every re-clamp.
 * Idempotent: output length is at most limit + suffix, which passes the guard.
 */
function hardTruncate(text: string, limit: number): string {
  if (text.length <= limit + TRUNCATED_SUFFIX.length) return text
  return text.slice(0, limit) + TRUNCATED_SUFFIX
}

function isTruncationStub(value: unknown): value is { __truncated: true; preview?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__truncated === true
  )
}

/** Idempotently shrink a JSON value to a small truncation stub. */
function minimizeJsonValue(value: unknown): { value: unknown; changed: boolean } {
  if (isTruncationStub(value)) {
    const preview = value.preview
    if (typeof preview === 'string') {
      const cut = hardTruncate(preview, MINIFIED_JSON_LIMIT)
      if (cut !== preview) return { value: { __truncated: true, preview: cut }, changed: true }
    }
    return { value, changed: false }
  }
  const serialized = safeStringify(value)
  if (serialized === null || serialized.length <= MINIFIED_JSON_LIMIT) {
    return { value, changed: false }
  }
  return {
    value: { __truncated: true, preview: hardTruncate(serialized, MINIFIED_JSON_LIMIT) },
    changed: true
  }
}

/** Shrink a part to a small stable stub, keeping its structure recognizable. */
function minimizePart(part: MessagePart): MessagePart {
  if (part.type === 'tool-call') {
    const args = minimizeJsonValue(part.args)
    const result = minimizeJsonValue(part.result)
    const outputText =
      part.outputText && part.outputText.length > DROPPED_OUTPUT_MARKER.length
        ? DROPPED_OUTPUT_MARKER
        : part.outputText
    if (!args.changed && !result.changed && outputText === part.outputText) return part
    return { ...part, args: args.value, result: result.value, outputText }
  }
  const text = hardTruncate(part.text, MINIFIED_LIMIT)
  if (text === part.text) return part
  return { ...part, text }
}

/**
 * Minimize oldest parts (then, if needed, all but the final part) until the
 * whole array fits TOTAL_PARTS_BUDGET. Idempotent: minimized parts are small
 * and stable, so re-clamping a persisted message is a no-op.
 */
function enforceTotalBudget(parts: MessagePart[]): { parts: MessagePart[]; changed: boolean } {
  let total = 0
  for (const part of parts) total += partSize(part)
  if (total <= TOTAL_PARTS_BUDGET) return { parts, changed: false }

  const out = parts.slice()
  let changed = false
  const shrink = (i: number): void => {
    const minimized = minimizePart(out[i])
    if (minimized === out[i]) return
    total -= partSize(out[i]) - partSize(minimized)
    out[i] = minimized
    changed = true
  }
  const recentStart = Math.max(0, out.length - RECENT_PARTS_KEPT)
  for (let i = 0; i < recentStart && total > TOTAL_PARTS_BUDGET; i++) shrink(i)
  // Still over budget: the recent tail itself is too big — minimize it too,
  // sparing only the final part (the one most likely still streaming).
  for (let i = recentStart; i < out.length - 1 && total > TOTAL_PARTS_BUDGET; i++) shrink(i)
  return { parts: out, changed }
}

/**
 * Returns the same reference when nothing exceeds limits; otherwise a copy
 * with oversized parts elided/replaced.
 */
export function clampMessageForStorage(message: StoredMessage): StoredMessage {
  let changed = false
  let parts = message.parts.map((part) => {
    const clamped = clampPart(part)
    if (clamped !== part) changed = true
    return clamped
  })
  const budgeted = enforceTotalBudget(parts)
  if (budgeted.changed) {
    parts = budgeted.parts
    changed = true
  }
  if (!changed) return message
  return { ...message, parts }
}
