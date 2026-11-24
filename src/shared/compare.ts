/**
 * Model comparison helpers (pure): limits, model-list validation, and the
 * titles of the chats a comparison creates — "<prompt summary> — <model>".
 * A comparison runs one prompt in one new worktree chat per model; the chats
 * share a `compare_group_id` so one can later be kept and the rest archived.
 */

export const COMPARE_MIN_MODELS = 2
export const COMPARE_MAX_MODELS = 4
export const COMPARE_PROMPT_MAX = 100_000
const SUMMARY_MAX = 40

/** First line of the prompt, whitespace-collapsed and cut to a short summary. */
export function summarizePrompt(prompt: string, max = SUMMARY_MAX): string {
  const firstLine =
    prompt
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  const flat = firstLine.replace(/\s+/g, ' ')
  if (flat.length <= max) return flat
  // Prefer cutting at a word boundary when one is reasonably close.
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Short display name of a model id: the part after the provider prefix. */
export function modelLabel(modelId: string): string {
  const trimmed = modelId.trim()
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 && slash < trimmed.length - 1 ? trimmed.slice(slash + 1) : trimmed
}

/** Title of one compared chat, e.g. `Fix the login redirect — some-model`. */
export function compareChatTitle(prompt: string, modelId: string): string {
  const summary = summarizePrompt(prompt) || 'Comparison'
  return `${summary} — ${modelLabel(modelId)}`
}

/**
 * Normalize a picked model list: trimmed, empties and duplicates dropped,
 * order kept. Returns an error message when the count is out of range.
 */
export function normalizeCompareModels(
  modelIds: string[]
): { ok: true; modelIds: string[] } | { ok: false; error: string } {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of modelIds) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  if (out.length < COMPARE_MIN_MODELS) {
    return { ok: false, error: `Pick at least ${COMPARE_MIN_MODELS} different models to compare.` }
  }
  if (out.length > COMPARE_MAX_MODELS) {
    return { ok: false, error: `Compare at most ${COMPARE_MAX_MODELS} models at once.` }
  }
  return { ok: true, modelIds: out }
}

/**
 * Lay compared chats out side by side: the first becomes the primary pane and
 * the rest fill split panes, capped at `maxExtraPanes` (chats beyond the cap
 * stay reachable from the sidebar).
 */
export function planCompareLayout<T extends { chatId: string; subchatId: string }>(
  chats: T[],
  maxExtraPanes: number
): { primary: T | null; panes: T[]; overflow: T[] } {
  if (chats.length === 0) return { primary: null, panes: [], overflow: [] }
  const rest = chats.slice(1)
  const cap = Math.max(0, maxExtraPanes)
  return { primary: chats[0], panes: rest.slice(0, cap), overflow: rest.slice(cap) }
}
