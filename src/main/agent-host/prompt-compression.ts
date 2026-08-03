/**
 * Pure, deterministic prompt compression (Headroom-style token compression).
 *
 * Shrinks stale tool outputs in an LLM-shaped prompt (LanguageModelV2Prompt)
 * right before the provider call: duplicate results are stubbed, huge
 * homogeneous JSON arrays are crushed (head + tail + error-like items kept,
 * one level of nesting too), noisy text is cleaned (ANSI escapes stripped,
 * repeated log lines collapsed), and long outputs are reduced to a head+tail
 * excerpt. Text outputs are first routed by detected content type: HTML is
 * stripped to its text, logs get progress/duplicate/stack-trace crushing, and
 * unified diffs are compacted structurally (context trimmed, whole trailing
 * hunks dropped) instead of taking the generic excerpt. The transformation is:
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
/** Log detection: at least this fraction of sampled lines look log-shaped. */
export const LOG_LINE_RATIO_MIN = 0.3
/** HTML detection: average tags per sampled line (when no doctype/html tag). */
export const HTML_TAG_DENSITY_MIN = 1
/** Log crush: runs of at least this many digit-only-varying progress lines. */
export const PROGRESS_RUN_MIN = 4
/** Log crush: runs of at least this many timestamp-stripped identical lines. */
export const LOG_DUP_RUN_MIN = 5
/** Log crush: stack traces with at least this many frames are trimmed... */
export const STACK_FRAME_MIN = 8
/** ...to this many leading frames... */
export const STACK_HEAD_FRAMES = 3
/** ...plus this many trailing frames. */
export const STACK_TAIL_FRAMES = 2
/** Diff compaction: context lines kept on each edge of a trimmed context run. */
export const DIFF_CONTEXT_KEEP = 2
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

export type DetectedContentType = 'diff' | 'log' | 'html' | 'plain'

// Leading ISO/clock timestamp, optionally bracketed — stripped when comparing
// log lines for duplicate runs and counted for log detection.
const TIMESTAMP_RE =
  /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*|^\[?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s*/
const LOG_LEVEL_RE = /^\s*\[?(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|SEVERE|FATAL)\b/i
// JS/Java "  at frame" and Python '  File "..."' stack-frame lines.
const STACK_FRAME_RE = /^\s+(?:at\s+\S|File ")/
const HTML_TAG_RE = /<\/?[a-zA-Z][^<>]*>/g
const DIFF_HUNK_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/

/**
 * Classify a tool output by its first ~50 lines so the cleanup pipeline can
 * route it: diff → structural compaction, html → tag stripping, log →
 * progress/duplicate/stack crushing. Deliberately conservative — anything
 * ambiguous is 'plain' and falls back to the generic path.
 */
export function detectContentType(text: string): DetectedContentType {
  const sample = text.split('\n', 50)
  if (sample.some((l) => l.startsWith('diff --git ') || DIFF_HUNK_RE.test(l))) return 'diff'
  if (/^\s*(?:<!DOCTYPE\s+html|<html[\s>])/i.test(text.slice(0, 500))) return 'html'
  const tagCount = (sample.join('\n').match(HTML_TAG_RE) ?? []).length
  if (tagCount >= 8 && tagCount / sample.length >= HTML_TAG_DENSITY_MIN) return 'html'
  if (/\r(?!\n)/.test(text)) return 'log' // progress bars rewriting the line
  const nonEmpty = sample.filter((l) => l.trim().length > 0)
  const logLines = nonEmpty.filter((l) => TIMESTAMP_RE.test(l) || LOG_LEVEL_RE.test(l)).length
  if (logLines >= 5 && logLines / Math.max(1, nonEmpty.length) >= LOG_LINE_RATIO_MIN) return 'log'
  return 'plain'
}

/**
 * Crush log-shaped text: resolve carriage-return progress rewrites, collapse
 * runs of digit-only-varying progress lines and timestamp-stripped duplicate
 * lines, and trim long stack traces to head + tail frames. Returns the input
 * unchanged (same reference) when nothing collapsed.
 */
export function crushLog(text: string): string {
  let normalized = text.replace(/\r\n/g, '\n')
  if (normalized.includes('\r')) {
    normalized = normalized
      .split('\n')
      .map((l) => l.slice(l.lastIndexOf('\r') + 1))
      .join('\n')
  }
  let lines = normalized.split('\n')

  // Pass 1: duplicate lines modulo a leading timestamp.
  const keys = lines.map((l) => l.replace(TIMESTAMP_RE, ''))
  let out: string[] = []
  for (let i = 0; i < lines.length;) {
    let run = 1
    while (i + run < lines.length && keys[i + run] === keys[i]) run++
    if (run >= LOG_DUP_RUN_MIN) {
      out.push(lines[i], `${COMPRESSION_MARKER}: previous line repeated ${run - 1} more times]`)
    } else {
      for (let k = 0; k < run; k++) out.push(lines[i + k])
    }
    i += run
  }
  lines = out

  // Pass 2: progress lines — identical after masking digits (counters,
  // percentages, byte counts) but not literally identical. Stack-frame lines
  // are excluded; the dedicated pass below keeps head + tail frames.
  const masked = lines.map((l) =>
    /\d/.test(l) && !STACK_FRAME_RE.test(l) ? l.replace(/\d+/g, '#') : null
  )
  out = []
  for (let i = 0; i < lines.length;) {
    let run = 1
    if (masked[i] !== null) {
      while (i + run < lines.length && masked[i + run] === masked[i]) run++
    }
    const allSame = run > 1 && lines.slice(i, i + run).every((l) => l === lines[i])
    if (run >= PROGRESS_RUN_MIN && !allSame) {
      out.push(
        lines[i],
        `${COMPRESSION_MARKER}: ${run - 2} similar progress lines omitted]`,
        lines[i + run - 1]
      )
    } else {
      for (let k = 0; k < run; k++) out.push(lines[i + k])
    }
    i += run
  }
  lines = out

  // Pass 3: long stack traces → head + tail frames.
  out = []
  for (let i = 0; i < lines.length;) {
    let run = 0
    while (i + run < lines.length && STACK_FRAME_RE.test(lines[i + run])) run++
    if (run >= STACK_FRAME_MIN) {
      const omitted = run - STACK_HEAD_FRAMES - STACK_TAIL_FRAMES
      out.push(
        ...lines.slice(i, i + STACK_HEAD_FRAMES),
        `${COMPRESSION_MARKER}: ${omitted} stack frames omitted]`,
        ...lines.slice(i + run - STACK_TAIL_FRAMES, i + run)
      )
      i += run
    } else if (run > 0) {
      for (let k = 0; k < run; k++) out.push(lines[i + k])
      i += run
    } else {
      out.push(lines[i])
      i++
    }
  }

  const result = out.join('\n')
  return result === text ? text : result
}

/**
 * Compact a unified diff without ever cutting inside a hunk: file and `@@`
 * headers and every `+`/`-` line are preserved; long context runs keep
 * DIFF_CONTEXT_KEEP lines per edge; if the result still exceeds maxChars,
 * whole trailing hunks are dropped (the first hunk is always kept). Returns
 * the input unchanged when nothing shrank.
 */
export function compressUnifiedDiff(text: string, maxChars: number): string {
  interface Block {
    hunk: boolean
    lines: string[]
  }
  const blocks: Block[] = []
  let cur: Block | null = null
  for (const line of text.split('\n')) {
    if (DIFF_HUNK_RE.test(line)) {
      cur = { hunk: true, lines: [line] }
      blocks.push(cur)
    } else if (line.startsWith('diff --git ') || !cur) {
      cur = { hunk: false, lines: [line] }
      blocks.push(cur)
    } else {
      cur.lines.push(line)
    }
  }
  if (!blocks.some((b) => b.hunk)) return text

  // Trim long context runs inside each hunk (never +/- lines).
  for (const block of blocks) {
    if (!block.hunk) continue
    const out: string[] = [block.lines[0]]
    const body = block.lines.slice(1)
    for (let i = 0; i < body.length;) {
      const isContext = (l: string): boolean => l.startsWith(' ') || l === ''
      if (!isContext(body[i])) {
        out.push(body[i])
        i++
        continue
      }
      let run = 1
      while (i + run < body.length && isContext(body[i + run])) run++
      if (run > DIFF_CONTEXT_KEEP * 2 + 1) {
        out.push(
          ...body.slice(i, i + DIFF_CONTEXT_KEEP),
          `${COMPRESSION_MARKER}: ${run - DIFF_CONTEXT_KEEP * 2} context lines omitted]`,
          ...body.slice(i + run - DIFF_CONTEXT_KEEP, i + run)
        )
      } else {
        out.push(...body.slice(i, i + run))
      }
      i += run
    }
    block.lines = out
  }

  // Budget pass: keep headers and leading hunks; drop whole trailing hunks.
  const lengthOf = (b: Block): number => b.lines.join('\n').length + 1
  let total = blocks.filter((b) => !b.hunk).reduce((sum, b) => sum + lengthOf(b), 0)
  let keptHunks = 0
  let droppedHunks = 0
  const kept: Block[] = []
  for (const block of blocks) {
    if (!block.hunk) {
      kept.push(block)
      continue
    }
    const size = lengthOf(block)
    if (keptHunks === 0 || total + size <= maxChars) {
      kept.push(block)
      total += size
      keptHunks++
    } else {
      droppedHunks++
    }
  }
  const parts = kept.flatMap((b) => b.lines)
  if (droppedHunks > 0) {
    parts.push(`${COMPRESSION_MARKER}: ${droppedHunks} more hunks omitted]`)
  }
  const result = parts.join('\n')
  return result.length < text.length ? result : text
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d'
}

/**
 * Strip HTML to its text content: script/style/comments removed, block
 * closers become newlines, remaining tags dropped, common and numeric
 * entities decoded, whitespace collapsed.
 */
export function stripHtml(text: string): string {
  let out = text
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<\/(?:p|div|section|article|li|ul|ol|table|tr|h[1-6]|header|footer|nav|blockquote|pre|form|title)\s*>|<br\s*\/?>/gi,
      '\n'
    )
    .replace(/<[^<>]+>/g, ' ')
  out = out.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent.startsWith('#')) {
      const hex = ent[1] === 'x' || ent[1] === 'X'
      const code = parseInt(ent.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isNaN(code) || code < 0 || code > 0x10ffff ? match : String.fromCodePoint(code)
    }
    return HTML_ENTITIES[ent.toLowerCase()] ?? match
  })
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

  // Provider-executed (server-side) tool results must reach the provider
  // byte-for-byte: e.g. Anthropic re-serializes web_search results into
  // web_search_tool_result blocks only when the json output matches its
  // schema, and silently drops rewritten ones — orphaning the tool_use and
  // failing the request. Collect their call ids so the loop can skip them.
  const providerExecutedIds = new Set<string>()
  for (const msg of prompt) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
    for (const p of msg.content) {
      const part = p as { type?: unknown; toolCallId?: unknown; providerExecuted?: unknown } | null
      if (
        part &&
        typeof part === 'object' &&
        part.type === 'tool-call' &&
        part.providerExecuted === true &&
        typeof part.toolCallId === 'string'
      )
        providerExecutedIds.add(part.toolCallId)
    }
  }

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
      // Skip provider-executed results entirely (also before duplicate
      // bookkeeping, so they never pair with client results as duplicates).
      if (
        (part as { providerExecuted?: unknown }).providerExecuted === true ||
        (toolCallId !== null && providerExecutedIds.has(toolCallId))
      )
        continue
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
        let kind: DetectedContentType = 'plain'
        if (output.type === 'json' || output.type === 'error-json') {
          const crushed = crushJsonValue(output.value, toolCallId)
          if (crushed !== null) {
            newOutput = { type: output.type, value: crushed }
            try {
              currentCanonical = JSON.stringify(crushed) ?? currentCanonical
            } catch {}
          }
        } else if (canonical.length >= MIN_CLEAN_CHARS) {
          // Text cleanup: strip ANSI escapes, then route by content type —
          // HTML is stripped to text, logs get progress/dup/stack crushing.
          let cleaned = stripAnsi(canonical)
          kind = detectContentType(cleaned)
          if (kind === 'html') cleaned = stripHtml(cleaned)
          else if (kind === 'log') cleaned = crushLog(cleaned)
          // Diffs skip line collapsing so +/- lines and hunks stay intact
          // for the structural compaction below.
          if (kind !== 'diff') cleaned = collapseRepeatedLines(cleaned)
          if (cleaned !== canonical) {
            newOutput = { type: isError ? 'error-text' : 'text', value: cleaned }
            currentCanonical = cleaned
          }
        }
        if (
          currentCanonical.length > EXCERPT_MIN_CHARS &&
          estimate(currentCanonical) >= MIN_COMPRESS_TOKENS
        ) {
          if (kind === 'diff') {
            // Diffs are compacted structurally, never sliced mid-hunk.
            const compacted = compressUnifiedDiff(
              currentCanonical,
              EXCERPT_HEAD_CHARS + EXCERPT_TAIL_CHARS
            )
            if (compacted !== currentCanonical) {
              newOutput = {
                type: isError ? 'error-text' : 'text',
                value:
                  compacted +
                  `\n${COMPRESSION_MARKER}: unified diff compacted — ${retrievalHint(toolCallId)}]`
              }
            }
          } else {
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
