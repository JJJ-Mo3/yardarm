/**
 * Robust extraction of a human-readable message from the SDK's error event
 * payloads. `ev.error` reaches the main process after a JSON round-trip, so
 * it can be an Error-like object, a plain object with nested error fields, a
 * bare string (sometimes a serialized JSON blob), or an empty object whose
 * message was lost in serialization. The extractor never returns blank text,
 * so the renderer's error banner always has something to show.
 */
const FALLBACK = 'Unknown agent error'
const MAX_DEPTH = 4

/** Nested fields that commonly carry the real error, in preference order. */
const NESTED_KEYS = ['cause', 'error', 'data', 'details'] as const

export function describeAgentError(err: unknown): string {
  return extract(err, 0) ?? FALLBACK
}

function extract(err: unknown, depth: number): string | null {
  if (err == null || depth > MAX_DEPTH) return null
  if (typeof err === 'string') return fromString(err, depth)
  if (typeof err !== 'object') {
    const text = String(err).trim()
    return text.length > 0 ? text : null
  }
  const obj = err as Record<string, unknown>
  if (typeof obj.message === 'string') {
    const message = fromString(obj.message, depth)
    if (message) return message
  }
  for (const key of NESTED_KEYS) {
    const nested = extract(obj[key], depth + 1)
    if (nested) return nested
  }
  // Last resort: identify the error by class name and/or provider code.
  const name =
    typeof obj.name === 'string' && obj.name.trim() && obj.name.trim() !== 'Error'
      ? obj.name.trim()
      : null
  const code =
    typeof obj.code === 'string' && obj.code.trim()
      ? obj.code.trim()
      : typeof obj.code === 'number'
        ? String(obj.code)
        : null
  if (name || code) return [name, code].filter(Boolean).join(' ')
  return null
}

/** Trimmed string, unwrapping JSON-blob messages the SDK sometimes emits. */
function fromString(text: string, depth: number): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const inner = extract(JSON.parse(trimmed), depth + 1)
      if (inner) return inner
    } catch {}
  }
  return trimmed
}
