/**
 * Pure message chunker for platform length limits. Splits long text into
 * chunks of at most `limit` characters, preferring paragraph boundaries, then
 * line boundaries, then hard splits; multi-chunk output gets an " (n/m)"
 * suffix on each chunk.
 */

const SUFFIX_RESERVE = 10 // " (99/99)" fits comfortably

/** Find the best split point at or before `limit` within text. */
function splitPoint(text: string, limit: number): number {
  const window = text.slice(0, limit + 1)
  const para = window.lastIndexOf('\n\n')
  if (para > limit * 0.3) return para + 2
  const line = window.lastIndexOf('\n')
  if (line > limit * 0.3) return line + 1
  const space = window.lastIndexOf(' ')
  if (space > limit * 0.5) return space + 1
  return limit
}

export function chunkMessage(text: string, limit: number): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= limit) return [trimmed]

  const budget = Math.max(1, limit - SUFFIX_RESERVE)
  const parts: string[] = []
  let rest = trimmed
  while (rest.length > budget) {
    const at = splitPoint(rest, budget)
    parts.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest) parts.push(rest)

  if (parts.length === 1) return parts
  return parts.map((p, i) => `${p} (${i + 1}/${parts.length})`)
}
