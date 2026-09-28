/**
 * Lossless dotenv-style .env model for the Factory harness.
 *
 * A .env file is parsed into a line-based structure that preserves every byte
 * (comments, blank lines, ordering, quoting, CRLF, missing trailing newline).
 * Untouched lines re-emit their original `raw` verbatim; only lines actually
 * changed by upsertEnv are re-rendered. The file is shared with Factory's own
 * tooling, so losslessness is the core requirement.
 */

export type EnvLine =
  | { kind: 'pair'; key: string; value: string; raw: string; eol: string }
  | { kind: 'other'; raw: string; eol: string }

const PAIR_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/

/**
 * Parse the text after `=`. Returns null when the line should be treated as
 * unparseable (kept verbatim as an `other` line). Unquoted values are taken
 * whole (no inline-comment stripping — `#` inside tokens/URLs is more common
 * than trailing comments, and being conservative keeps writes safe).
 */
function parseValue(rest: string): string | null {
  const trimmed = rest.trim()
  if (trimmed.startsWith('"')) {
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i] === '\\') {
        i++
        continue
      }
      if (trimmed[i] === '"') {
        return trimmed
          .slice(1, i)
          .replace(/\\(.)/g, (_, c: string) =>
            c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c
          )
      }
    }
    return null // unterminated quote
  }
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1)
    if (end === -1) return null
    return trimmed.slice(1, end)
  }
  return trimmed
}

export function parseEnvFile(text: string): EnvLine[] {
  const out: EnvLine[] = []
  let i = 0
  while (i < text.length) {
    const nl = text.indexOf('\n', i)
    let content: string
    let eol: string
    if (nl === -1) {
      content = text.slice(i)
      eol = ''
      i = text.length
    } else {
      const end = nl > i && text[nl - 1] === '\r' ? nl - 1 : nl
      content = text.slice(i, end)
      eol = text.slice(end, nl + 1)
      i = nl + 1
    }
    const m = PAIR_RE.exec(content)
    const value = m ? parseValue(m[2]) : null
    if (m && value !== null) out.push({ kind: 'pair', key: m[1], value, raw: content, eol })
    else out.push({ kind: 'other', raw: content, eol })
  }
  return out
}

export function serializeEnvFile(lines: EnvLine[]): string {
  return lines.map((l) => l.raw + l.eol).join('')
}

/** Quote only when needed; base64 `+/=` and URLs stay unquoted. */
function renderPair(key: string, value: string): string {
  if (!/[\s#"'\\]/.test(value)) return `${key}=${value}`
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `${key}="${escaped}"`
}

/**
 * Apply updates: each key edits its last occurrence (dotenv last-wins
 * semantics) or is appended. Lines whose value is already equal are left
 * byte-identical. Returns a new array; the input is not mutated.
 */
export function upsertEnv(lines: EnvLine[], updates: Record<string, string>): EnvLine[] {
  const out: EnvLine[] = lines.slice()
  for (const [key, value] of Object.entries(updates)) {
    let lastIdx = -1
    for (let j = 0; j < out.length; j++) {
      const l = out[j]
      if (l.kind === 'pair' && l.key === key) lastIdx = j
    }
    if (lastIdx >= 0) {
      const existing = out[lastIdx] as Extract<EnvLine, { kind: 'pair' }>
      if (existing.value === value) continue
      out[lastIdx] = { kind: 'pair', key, value, raw: renderPair(key, value), eol: existing.eol }
    } else {
      const last = out[out.length - 1]
      if (last && last.eol === '') out[out.length - 1] = { ...last, eol: '\n' }
      out.push({ kind: 'pair', key, value, raw: renderPair(key, value), eol: '\n' })
    }
  }
  return out
}

/** Last-wins lookup of a single key. */
export function getEnv(lines: EnvLine[], key: string): string | undefined {
  let found: string | undefined
  for (const l of lines) {
    if (l.kind === 'pair' && l.key === key) found = l.value
  }
  return found
}

/** Last-wins map of all pairs. */
export function listEnv(lines: EnvLine[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const l of lines) {
    if (l.kind === 'pair') map[l.key] = l.value
  }
  return map
}
