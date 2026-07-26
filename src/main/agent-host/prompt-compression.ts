/**
 * Pure, deterministic prompt compression (Headroom-style token compression).
 *
 * Shrinks stale tool outputs in an LLM-shaped prompt (LanguageModelV2Prompt)
 * right before the provider call: duplicate results are stubbed, huge
 * homogeneous JSON arrays are crushed, and long outputs are reduced to a
 * head+tail excerpt. The transformation is:
 *
 * - transient — callers apply it per model call; stored history is untouched
 * - prefix-stable — a message's compressed form depends only on itself and
 *   earlier messages, so provider KV caches keep hitting as turns append
 * - idempotent — already-compressed parts (marker present) are skipped
 *
 * No SDK or Node imports: types are structural so this module is unit-testable
 * and immune to SDK type churn. Assistant text/reasoning is never compressed
 * in v1 (possible future extension).
 */

/** Recent user turns whose messages (and everything after) are never touched. */
export const PROTECTED_RECENT_USER_TURNS = 3
/** Minimum estimated tokens before a head+tail excerpt is applied. */
export const MIN_COMPRESS_TOKENS = 600
export const EXCERPT_HEAD_CHARS = 1500
export const EXCERPT_TAIL_CHARS = 1000
/** Homogeneous JSON arrays of at least this length are crushed... */
export const JSON_ARRAY_MIN = 20
/** ...down to this many leading items plus an omission marker. */
export const JSON_ARRAY_KEEP = 5
/** Prefix of every replacement we inject; also the idempotence sentinel. */
export const COMPRESSION_MARKER = '[Yardarm compressed'

/** Excerpting must actually shrink the text (head + tail + marker slack). */
const EXCERPT_MIN_CHARS = EXCERPT_HEAD_CHARS + EXCERPT_TAIL_CHARS + 200

/** Loose structural view of a LanguageModelV2 prompt message. */
export interface CompressiblePromptMessage {
  role: string
  content: unknown
  providerOptions?: unknown
}

export interface CompressionOptions {
  /** Token estimator for plain text (SDK tokenEstimate or chars/4 fallback). */
  estimate: (text: string) => number
}

export interface CompressionResult {
  /** Original array reference when changed is false. */
  prompt: CompressiblePromptMessage[]
  /** Estimated tokens saved across all rewritten tool results. */
  tokensSaved: number
  changed: boolean
}

interface ToolResultOutput {
  type: string
  value: unknown
}

/** 32-bit FNV-1a — deterministic, dependency-free duplicate fingerprint. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Canonical text of a tool-result output, or null when the output must be
 * skipped (media-bearing content, unknown types, malformed values).
 */
function canonicalTextOf(output: ToolResultOutput): string | null {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return typeof output.value === 'string' ? output.value : null
    case 'json':
    case 'error-json':
      try {
        return JSON.stringify(output.value) ?? 'null'
      } catch {
        return null
      }
    case 'content': {
      if (!Array.isArray(output.value)) return null
      const texts: string[] = []
      for (const part of output.value) {
        const p = part as { type?: unknown; text?: unknown } | null
        if (p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string') {
          texts.push(p.text)
        } else {
          return null // media or unknown part — leave the whole output alone
        }
      }
      return texts.join('\n')
    }
    default:
      return null
  }
}

/** All items share one primitive/array/object shape class. */
function isHomogeneousArray(value: unknown[]): boolean {
  if (value.length === 0) return false
  const classOf = (v: unknown): string =>
    v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
  const first = classOf(value[0])
  return value.every((v) => classOf(v) === first)
}

/**
 * Compress stale tool results in a prompt. Copy-on-write: untouched messages
 * (and the array itself when nothing changed) keep reference identity.
 */
export function compressPrompt(
  prompt: CompressiblePromptMessage[],
  opts: CompressionOptions
): CompressionResult {
  // Protection boundary: index of the Kth-from-last user message. Everything
  // at or after it is protected; with fewer than K user turns, nothing is old
  // enough to compress.
  let userSeen = 0
  let boundary = -1
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === 'user') {
      userSeen++
      if (userSeen === PROTECTED_RECENT_USER_TURNS) {
        boundary = i
        break
      }
    }
  }
  if (boundary < 0) return { prompt, tokensSaved: 0, changed: false }

  const { estimate } = opts
  const seenHashes = new Set<string>()
  let tokensSaved = 0
  let out = prompt

  for (let i = 0; i < prompt.length; i++) {
    const msg = prompt[i]
    if (msg.role !== 'tool' && msg.role !== 'assistant') continue
    const content = msg.content
    if (!Array.isArray(content)) continue
    const isProtected = i >= boundary

    let newContent: unknown[] | null = null
    for (let j = 0; j < content.length; j++) {
      const part = content[j] as { type?: unknown; toolName?: unknown; output?: unknown } | null
      if (!part || typeof part !== 'object' || part.type !== 'tool-result') continue
      const output = part.output as ToolResultOutput | undefined
      if (!output || typeof output !== 'object' || typeof output.type !== 'string') continue
      const canonical = canonicalTextOf(output)
      if (canonical === null) continue
      // Idempotence: never re-touch something we already rewrote.
      if (canonical.includes(COMPRESSION_MARKER)) continue

      const toolName = typeof part.toolName === 'string' ? part.toolName : 'tool'
      const hash = fnv1a(toolName + '\u0000' + canonical)
      const isDuplicate = seenHashes.has(hash)
      seenHashes.add(hash)
      if (isProtected) continue

      const isError = output.type === 'error-text' || output.type === 'error-json'
      const before = estimate(canonical)
      let newOutput: ToolResultOutput | null = null

      if (isDuplicate) {
        // Later duplicates become a stub; the first occurrence is kept so
        // earlier bytes never change (prefix stability).
        newOutput = {
          type: isError ? 'error-text' : 'text',
          value: `${COMPRESSION_MARKER}: identical to an earlier ${toolName} result — re-run the tool for full output]`
        }
      } else {
        let current = output
        let currentCanonical = canonical
        if (
          (output.type === 'json' || output.type === 'error-json') &&
          Array.isArray(output.value) &&
          output.value.length >= JSON_ARRAY_MIN &&
          isHomogeneousArray(output.value)
        ) {
          const omitted = output.value.length - JSON_ARRAY_KEEP
          const crushed = [
            ...output.value.slice(0, JSON_ARRAY_KEEP),
            `${COMPRESSION_MARKER}: ${omitted} more items omitted — re-run the tool for full output]`
          ]
          current = { type: output.type, value: crushed }
          currentCanonical = JSON.stringify(crushed)
          newOutput = current
        }
        if (
          currentCanonical.length > EXCERPT_MIN_CHARS &&
          estimate(currentCanonical) >= MIN_COMPRESS_TOKENS
        ) {
          const omitted = currentCanonical.length - EXCERPT_HEAD_CHARS - EXCERPT_TAIL_CHARS
          newOutput = {
            type: isError ? 'error-text' : 'text',
            value:
              currentCanonical.slice(0, EXCERPT_HEAD_CHARS) +
              `\n${COMPRESSION_MARKER}: ${omitted} chars omitted — re-run the tool for full output]\n` +
              currentCanonical.slice(-EXCERPT_TAIL_CHARS)
          }
        }
      }

      if (!newOutput) continue
      const afterCanonical = canonicalTextOf(newOutput)
      const saved = before - estimate(afterCanonical ?? '')
      if (saved <= 0) continue // replacements must actually save tokens
      tokensSaved += saved
      if (!newContent) newContent = [...content]
      newContent[j] = { ...part, output: newOutput }
    }

    if (newContent) {
      if (out === prompt) out = [...prompt]
      out[i] = { ...msg, content: newContent }
    }
  }

  const changed = out !== prompt
  return { prompt: out, tokensSaved: changed ? tokensSaved : 0, changed }
}
