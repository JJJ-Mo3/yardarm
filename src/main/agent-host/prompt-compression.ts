/**
 * Pure, deterministic prompt compression (Headroom-style token compression).
 *
 * Shrinks stale tool outputs in an LLM-shaped prompt (LanguageModelV2Prompt)
 * right before the provider call: duplicate results are stubbed, huge
 * homogeneous JSON arrays are crushed (head + tail + error-like items kept,
 * one level of nesting too), noisy text is cleaned (ANSI escapes stripped,
 * repeated log lines collapsed), and long outputs are reduced to a head+tail
 * excerpt. The transformation is:
 *
 * - transient — callers apply it per model call; stored history is untouched
 * - prefix-stable — a message's compressed form depends only on itself and
 *   earlier messages, so provider KV caches keep hitting as turns append
 * - idempotent — already-compressed parts (marker present) are skipped
 * - reversible — every rewritten part is reported in `originals` so the host
 *   can serve the full text back through the retrieve_full_output tool
 *
 * Also exports `applyVerbositySteering`, an independent cache-preserving
 * system-prompt suffix nudging the model toward terser replies.
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
/** ...down to this many leading items... */
export const JSON_ARRAY_KEEP = 5
/** ...plus this many trailing items (SmartCrusher-style head+tail retention). */
export const JSON_ARRAY_TAIL_KEEP = 2
/** Error-like items from the crushed middle are preserved, capped at this. */
export const JSON_ARRAY_ERROR_KEEP = 3
/** Runs of at least this many identical lines are collapsed to one + marker. */
export const LINE_REPEAT_MIN = 5
/** Text cleaning (ANSI strip, line collapse) applies only at/above this size. */
export const MIN_CLEAN_CHARS = 400
/** Prefix of every replacement we inject; also the idempotence sentinel. */
export const COMPRESSION_MARKER = '[Yardarm compressed'
/** Name of the host-provided tool that returns compressed originals. */
export const RETRIEVAL_TOOL_NAME = 'retrieve_full_output'

/**
 * Verbosity steering: appended once to the system message when enabled.
 * Constant across calls within a session, so KV caches are unaffected.
 */
export const VERBOSITY_SUFFIX =
  'Be concise. Do not restate tool outputs or file contents in your replies, avoid repeating ' +
  'unchanged plans, and keep explanations brief unless the user explicitly asks for detail.'

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

/** Original text of a rewritten tool result, for the retrieval store. */
export interface CompressedOriginal {
  toolCallId: string
  toolName: string
  text: string
}

export interface CompressionResult {
  /** Original array reference when changed is false. */
  prompt: CompressiblePromptMessage[]
  /** Estimated tokens saved across all rewritten tool results. */
  tokensSaved: number
  changed: boolean
  /** Full originals of every rewritten tool result (empty when unchanged). */
  originals: CompressedOriginal[]
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

/** How the model should get the full output back. */
function retrievalHint(toolCallId: string | null): string {
  return toolCallId
    ? `call ${RETRIEVAL_TOOL_NAME} with toolCallId "${toolCallId}" for the full output`
    : 're-run the tool for full output'
}

// CSI (colors, cursor moves) and OSC (titles, hyperlinks) escape sequences.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;:?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

/** Strip ANSI escape sequences (log/terminal output cleanup). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/**
 * Collapse runs of >= LINE_REPEAT_MIN identical lines to the first line plus
 * an omission marker (progress spinners, retry loops, repeated warnings).
 */
export function collapseRepeatedLines(text: string): string {
  if (!text.includes('\n')) return text
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    let run = 1
    while (i + run < lines.length && lines[i + run] === lines[i]) run++
    if (run >= LINE_REPEAT_MIN) {
      out.push(lines[i], `${COMPRESSION_MARKER}: previous line repeated ${run - 1} more times]`)
    } else {
      for (let k = 0; k < run; k++) out.push(lines[i])
    }
    i += run
  }
  return out.join('\n')
}

/** Item looks error-bearing (kept when crushing arrays, like SmartCrusher). */
function isErrorLike(item: unknown): boolean {
  try {
    return /error|fail/i.test(JSON.stringify(item) ?? '')
  } catch {
    return false
  }
}

/**
 * Crush a homogeneous array to head + error-like middle items (capped) +
 * omission marker + tail. Returns null when the array is too short.
 */
function crushArray(value: unknown[], toolCallId: string | null): unknown[] | null {
  if (value.length < JSON_ARRAY_MIN || !isHomogeneousArray(value)) return null
  const tailStart = value.length - JSON_ARRAY_TAIL_KEEP
  const errors: unknown[] = []
  for (let i = JSON_ARRAY_KEEP; i < tailStart && errors.length < JSON_ARRAY_ERROR_KEEP; i++) {
    if (isErrorLike(value[i])) errors.push(value[i])
  }
  const omitted = value.length - JSON_ARRAY_KEEP - JSON_ARRAY_TAIL_KEEP - errors.length
  if (omitted <= 0) return null
  return [
    ...value.slice(0, JSON_ARRAY_KEEP),
    ...errors,
    `${COMPRESSION_MARKER}: ${omitted} more items omitted — ${retrievalHint(toolCallId)}]`,
    ...value.slice(tailStart)
  ]
}

/**
 * Crush the top-level array of a JSON output, or (one level deep) any
 * homogeneous array values of a plain top-level object. Returns null when
 * nothing qualified.
 */
function crushJsonValue(value: unknown, toolCallId: string | null): unknown | null {
  if (Array.isArray(value)) return crushArray(value, toolCallId)
  if (value && typeof value === 'object') {
    let out: Record<string, unknown> | null = null
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      const v = obj[key]
      if (!Array.isArray(v)) continue
      const crushed = crushArray(v, toolCallId)
      if (crushed) {
        if (!out) out = { ...obj }
        out[key] = crushed
      }
    }
    return out
  }
  return null
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
  if (boundary < 0) return { prompt, tokensSaved: 0, changed: false, originals: [] }

  const { estimate } = opts
  const seenHashes = new Set<string>()
  let tokensSaved = 0
  const originals: CompressedOriginal[] = []
  let out = prompt

  for (let i = 0; i < prompt.length; i++) {
    const msg = prompt[i]
    if (msg.role !== 'tool' && msg.role !== 'assistant') continue
    const content = msg.content
    if (!Array.isArray(content)) continue
    const isProtected = i >= boundary

    let newContent: unknown[] | null = null
    for (let j = 0; j < content.length; j++) {
      const part = content[j] as {
        type?: unknown
        toolName?: unknown
        toolCallId?: unknown
        output?: unknown
      } | null
      if (!part || typeof part !== 'object' || part.type !== 'tool-result') continue
      const output = part.output as ToolResultOutput | undefined
      if (!output || typeof output !== 'object' || typeof output.type !== 'string') continue
      const canonical = canonicalTextOf(output)
      if (canonical === null) continue
      // Idempotence: never re-touch something we already rewrote.
      if (canonical.includes(COMPRESSION_MARKER)) continue

      const toolName = typeof part.toolName === 'string' ? part.toolName : 'tool'
      const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : null
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
          value: `${COMPRESSION_MARKER}: identical to an earlier ${toolName} result — ${retrievalHint(toolCallId)}]`
        }
      } else {
        let currentCanonical = canonical
        if (output.type === 'json' || output.type === 'error-json') {
          const crushed = crushJsonValue(output.value, toolCallId)
          if (crushed !== null) {
            newOutput = { type: output.type, value: crushed }
            try {
              currentCanonical = JSON.stringify(crushed) ?? currentCanonical
            } catch {}
          }
        } else if (canonical.length >= MIN_CLEAN_CHARS) {
          // Text cleanup: strip ANSI escapes, collapse repeated log lines.
          const cleaned = collapseRepeatedLines(stripAnsi(canonical))
          if (cleaned !== canonical) {
            newOutput = { type: isError ? 'error-text' : 'text', value: cleaned }
            currentCanonical = cleaned
          }
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
              `\n${COMPRESSION_MARKER}: ${omitted} chars omitted — ${retrievalHint(toolCallId)}]\n` +
              currentCanonical.slice(-EXCERPT_TAIL_CHARS)
          }
        }
      }

      if (!newOutput) continue
      const afterCanonical = canonicalTextOf(newOutput)
      const saved = before - estimate(afterCanonical ?? '')
      if (saved <= 0) continue // replacements must actually save tokens
      tokensSaved += saved
      if (toolCallId) originals.push({ toolCallId, toolName, text: canonical })
      if (!newContent) newContent = [...content]
      newContent[j] = { ...part, output: newOutput }
    }

    if (newContent) {
      if (out === prompt) out = [...prompt]
      out[i] = { ...msg, content: newContent }
    }
  }

  const changed = out !== prompt
  return {
    prompt: out,
    tokensSaved: changed ? tokensSaved : 0,
    changed,
    originals: changed ? originals : []
  }
}

/**
 * Append the verbosity-steering suffix to the first system message (string
 * content only). Copy-on-write and idempotent; a no-op when the prompt has no
 * system message.
 */
export function applyVerbositySteering(prompt: CompressiblePromptMessage[]): {
  prompt: CompressiblePromptMessage[]
  changed: boolean
} {
  for (let i = 0; i < prompt.length; i++) {
    const msg = prompt[i]
    if (msg.role !== 'system') continue
    if (typeof msg.content !== 'string') return { prompt, changed: false }
    if (msg.content.includes(VERBOSITY_SUFFIX)) return { prompt, changed: false }
    const out = [...prompt]
    out[i] = { ...msg, content: msg.content + '\n\n' + VERBOSITY_SUFFIX }
    return { prompt: out, changed: true }
  }
  return { prompt, changed: false }
}
