/**
 * Pure fuzzy filename ranking for the Cmd+O quick-open dialog. Mirrors the
 * files.search ranking in src/main/lib/trpc/routers/files.ts: basename prefix
 * beats basename substring beats path substring beats path subsequence, with
 * shorter paths winning ties within a tier.
 */

/** Match tier for a path against a lowercase query: 0 (best) to 3, or -1 for no match. */
export function fuzzyScore(p: string, q: string): number {
  if (!q) return 0
  const lower = p.toLowerCase()
  const slash = lower.lastIndexOf('/')
  const base = slash >= 0 ? lower.slice(slash + 1) : lower
  if (base.startsWith(q)) return 0
  if (base.includes(q)) return 1
  if (lower.includes(q)) return 2
  let i = 0
  for (const ch of lower) {
    if (ch === q[i]) i++
    if (i === q.length) return 3
  }
  return -1
}

/** Top `limit` paths matching `query`, best tier first, shorter paths breaking ties. */
export function fuzzyFilter(paths: string[], query: string, limit: number): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return paths.slice(0, limit)
  const scored: Array<{ p: string; score: number }> = []
  for (const p of paths) {
    const score = fuzzyScore(p, q)
    if (score >= 0) scored.push({ p, score })
  }
  scored.sort((a, b) => a.score - b.score || a.p.length - b.p.length)
  return scored.slice(0, limit).map((s) => s.p)
}
