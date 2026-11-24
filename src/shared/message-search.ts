/**
 * Pure helpers for cross-chat message search: what text of a stored message is
 * indexed, how free-form user input becomes a safe FTS5 MATCH expression, and
 * how highlighted snippets travel to the renderer. No electron/DB imports —
 * the index itself lives in src/main/lib/db/message-search.ts.
 */
import { stripAgentMarkers } from './agent-markers'

/** Upper bound on indexed characters per message (long replies are truncated). */
export const SEARCH_BODY_MAX = 60_000
/** Max terms taken from one query; the rest are ignored. */
export const SEARCH_MAX_TERMS = 12
/** Max characters of user input considered. */
export const SEARCH_MAX_INPUT = 300

/** Control characters wrapping matched terms in snippets (never valid in text). */
export const SNIPPET_OPEN = '\u0001'
export const SNIPPET_CLOSE = '\u0002'

export interface MessageSearchHit {
  messageId: string
  subchatId: string
  chatId: string
  chatTitle: string
  chatArchived: boolean
  projectId: string
  projectName: string
  role: 'user' | 'assistant'
  /** Excerpt with matches wrapped in SNIPPET_OPEN/SNIPPET_CLOSE. */
  snippet: string
  createdAt: number
}

/** Replace every character with a code up to `maxCode` (control range) by a space. */
function replaceControlChars(text: string, maxCode: number): string {
  let out = ''
  for (const ch of text) out += ch.charCodeAt(0) <= maxCode ? ' ' : ch
  return out
}

/**
 * The searchable text of a message: user and assistant text parts only (never
 * tool calls, tool output, reasoning or info lines), with the agent's
 * machine-readable marker lines dropped from assistant replies. Returns ''
 * when there is nothing to index.
 */
export function extractSearchText(role: string, parts: unknown): string {
  if (role !== 'user' && role !== 'assistant') return ''
  if (!Array.isArray(parts)) return ''
  const texts: string[] = []
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type !== 'text' || typeof p.text !== 'string') continue
    const text = role === 'assistant' ? stripAgentMarkers(p.text) : p.text
    if (text.trim()) texts.push(text.trim())
  }
  const body = replaceControlChars(texts.join('\n'), 2)
  return body.length > SEARCH_BODY_MAX ? body.slice(0, SEARCH_BODY_MAX) : body
}

/** Whitespace-separated terms that contain at least one letter or digit. */
function searchTerms(input: string): string[] {
  return replaceControlChars(input.slice(0, SEARCH_MAX_INPUT), 31)
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, SEARCH_MAX_TERMS)
}

/**
 * Turn free-form input into an FTS5 MATCH expression: every term becomes a
 * double-quoted string (so operators, column filters, parentheses and `NEAR`
 * are plain text, never syntax), terms are AND-ed, and the last term is a
 * prefix match so results appear while typing. Returns null when the input
 * has no searchable term.
 */
export function buildFtsQuery(input: string): string | null {
  const terms = searchTerms(input)
  if (terms.length === 0) return null
  return terms.map((t, i) => `"${t}"${i === terms.length - 1 ? '*' : ''}`).join(' ')
}

/**
 * The single term to hand to the in-chat find bar after opening a result (it
 * matches one literal substring, not an AND of terms): the longest term,
 * trimmed of surrounding punctuation.
 */
export function highlightTerm(input: string): string {
  let best = ''
  for (const term of searchTerms(input)) {
    const core = term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (core.length > best.length) best = core
  }
  return best
}

/** Split a marked snippet into plain and matched segments for rendering. */
export function splitSnippet(snippet: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = []
  let rest = snippet
  while (rest.length > 0) {
    const open = rest.indexOf(SNIPPET_OPEN)
    if (open === -1) break
    const close = rest.indexOf(SNIPPET_CLOSE, open + 1)
    if (close === -1) break
    if (open > 0) out.push({ text: rest.slice(0, open), hit: false })
    out.push({ text: rest.slice(open + 1, close), hit: true })
    rest = rest.slice(close + 1)
  }
  const tail = rest.split(SNIPPET_OPEN).join('').split(SNIPPET_CLOSE).join('')
  if (tail) out.push({ text: tail, hit: false })
  return out
}
