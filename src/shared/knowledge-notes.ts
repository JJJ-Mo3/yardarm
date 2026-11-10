/**
 * Editable knowledge notes (Devin-style "Knowledge"): user-authored,
 * project-scoped notes stored in the app DB. Pinned note bodies are inlined
 * into the system prompt via pluginInstructions; the rest are listed by title
 * and fetched on demand through the knowledge_note_lookup extra tool. A
 * suggestion guidance line asks the agent to propose new notes with a
 * one-line end-of-reply marker the renderer turns into a save/dismiss card.
 * Pure and shared — distinct from the SDK's experimental knowledge base
 * (agent memory), which Yardarm only browses read-only in /knowledge.
 */

/** Maximum notes considered per project (manager-enforced, not just UI). */
export const MAX_NOTES = 50
/** Cumulative pinned-body budget; overflow demotes pinned notes to lookup. */
export const MAX_PINNED_BYTES = 4096
/** Per-note body cap (enforced at create/update and defensively at boot). */
export const MAX_NOTE_BODY_CHARS = 4000
/** Per-note title cap. */
export const MAX_NOTE_TITLE_CHARS = 200

/** Name of the auto-approved extra tool that returns unpinned note bodies. */
export const KNOWLEDGE_LOOKUP_TOOL_NAME = 'knowledge_note_lookup'

/**
 * First line of the prompt block; the host removes stale variants by prefix
 * match, so this must never change between versions.
 */
export const KNOWLEDGE_BLOCK_PREFIX = '[Yardarm knowledge notes]'

/** One note as shipped to the agent host in HostBootConfig. */
export interface KnowledgeNoteBoot {
  id: string
  title: string
  body: string
}

/**
 * Build the pluginInstructions block: pinned bodies verbatim plus a
 * titles-only index of lookup notes. Returns null when there are no notes.
 * Deterministic for identical inputs so unchanged notes produce a
 * byte-identical block (the host's write-on-change guard then keeps
 * steady-state boots prefix-stable).
 */
export function buildKnowledgeBlock(
  pinned: KnowledgeNoteBoot[],
  lookup: KnowledgeNoteBoot[]
): string | null {
  if (pinned.length === 0 && lookup.length === 0) return null
  const lines: string[] = [
    `${KNOWLEDGE_BLOCK_PREFIX} User-maintained notes about this project. ` +
      'Follow them when relevant to the task.'
  ]
  if (pinned.length > 0) {
    lines.push('Pinned notes:')
    for (const n of pinned) lines.push(`- ${n.title}: ${n.body}`)
  }
  if (lookup.length > 0) {
    lines.push(
      `Other notes (fetch a body with the ${KNOWLEDGE_LOOKUP_TOOL_NAME} tool using the id):`
    )
    for (const n of lookup) lines.push(`- ${n.title} (id: ${n.id})`)
  }
  return lines.join('\n')
}

/**
 * Split enabled notes into prompt-pinned and lookup sets, applying the caps:
 * at most MAX_NOTES total, bodies clamped to MAX_NOTE_BODY_CHARS, and pinned
 * bodies kept within MAX_PINNED_BYTES cumulatively (overflow demotes to
 * lookup, preserving input order). Pure so the caps are testable and apply
 * to any future write path, not just the UI.
 */
export function planKnowledgeBoot(
  notes: { id: string; title: string; body: string; pinned: boolean }[]
): { pinned: KnowledgeNoteBoot[]; lookup: KnowledgeNoteBoot[] } {
  const pinned: KnowledgeNoteBoot[] = []
  const lookup: KnowledgeNoteBoot[] = []
  let pinnedBytes = 0
  for (const note of notes.slice(0, MAX_NOTES)) {
    const boot: KnowledgeNoteBoot = {
      id: note.id,
      title: note.title.slice(0, MAX_NOTE_TITLE_CHARS),
      body: note.body.slice(0, MAX_NOTE_BODY_CHARS)
    }
    const bytes = byteLength(boot.body)
    if (note.pinned && pinnedBytes + bytes <= MAX_PINNED_BYTES) {
      pinned.push(boot)
      pinnedBytes += bytes
    } else {
      lookup.push(boot)
    }
  }
  return { pinned, lookup }
}

/** UTF-8 byte length without Buffer (shared module runs in the renderer too). */
function byteLength(text: string): number {
  let bytes = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
  }
  return bytes
}

/**
 * Injected into pluginInstructions at host boot (beside the confidence
 * guidance) when the "Suggest knowledge notes" preference is on. Kept short
 * and stable so it stays prefix-cache friendly.
 */
export const SUGGEST_KNOWLEDGE_GUIDANCE =
  'When a conversation reveals a durable, project-specific fact worth remembering (a ' +
  'convention, gotcha, or correction from the user), end your reply with a single line of ' +
  'the form "Suggested knowledge: <one concise self-contained note>". Suggest at most one ' +
  'per reply, only for facts that will stay true across future tasks — never for ' +
  'task-specific or obvious details.'

/**
 * Lenient one-line marker matcher: tolerates markdown bold, casing, :=–—-
 * separators, and blockquote/list prefixes. Payload capture stops at end of
 * line.
 */
const SUGGEST_RE = /^[>\s*-]*(?:\*\*)?suggested knowledge(?:\*\*)?\s*[:=\-–—]\s*(.+)$/i

/** A ``` or ~~~ fence delimiter line (suggestions inside code blocks are ignored). */
function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line)
}

/** Extract the payload if the line is a valid suggestion marker, else null. */
function matchSuggestion(line: string): string | null {
  const m = SUGGEST_RE.exec(line)
  if (!m) return null
  const payload = m[1].replace(/\*\*\s*$/, '').trim()
  // Length floor guards against false positives like "Suggested knowledge: none".
  return payload.length >= 10 ? payload : null
}

/** Parse the last suggested-knowledge marker outside code fences, if any. */
export function parseSuggestedKnowledge(text: string): string | null {
  let inFence = false
  let found: string | null = null
  for (const line of text.split('\n')) {
    if (isFenceLine(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const payload = matchSuggestion(line)
    if (payload) found = payload
  }
  return found
}

/** Remove suggestion marker lines (the card replaces them in the UI). */
export function stripSuggestedKnowledgeLine(text: string): string {
  if (parseSuggestedKnowledge(text) === null) return text
  let inFence = false
  const kept = text.split('\n').filter((line) => {
    if (isFenceLine(line)) {
      inFence = !inFence
      return true
    }
    if (inFence) return true
    return matchSuggestion(line) === null
  })
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
