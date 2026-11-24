/**
 * `yardarm://` deep-link parsing and validation (pure, unit-tested; used by
 * the main process on arrival and by the renderer to resolve the project).
 * Everything in a link is untrusted: only the `new` action exists, both
 * parameters are length-capped (over-long input is rejected, never silently
 * truncated), control and bidi-override characters are stripped, unknown
 * parameters are ignored and anything else is rejected. A parsed link is only
 * ever a *request* — it selects a project and prefills the new-chat flow; the
 * user still has to click to create the chat and to send the prompt.
 *
 * Format: yardarm://new?project=<project name>&prompt=<text>
 */

/** The only URL scheme the app registers. */
export const DEEP_LINK_SCHEME = 'yardarm'
/** Longest accepted raw link (encoded form). */
export const DEEP_LINK_MAX_URL_LENGTH = 32_768
/** Longest accepted decoded `project` value, in UTF-16 code units. */
export const DEEP_LINK_MAX_PROJECT_LENGTH = 200
/** Longest accepted decoded `prompt` value, in UTF-16 code units. */
export const DEEP_LINK_MAX_PROMPT_LENGTH = 8_000

export interface DeepLinkNewRequest {
  action: 'new'
  /** Project name to select (matched case-insensitively), or null for the current project. */
  project: string | null
  /** Text to carry into the new chat's composer as a prefill, or null. */
  prompt: string | null
}

export type DeepLinkResult =
  { ok: true; request: DeepLinkNewRequest } | { ok: false; error: string }

function fail(error: string): DeepLinkResult {
  return { ok: false, error }
}

/** C0/C1 control characters (optionally keeping tab and newline). */
function isControl(code: number, keepWhitespace: boolean): boolean {
  if (keepWhitespace && (code === 0x09 || code === 0x0a)) return false
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

/** Bidi embedding/override/isolate characters, which can visually disguise text. */
function isBidiControl(code: number): boolean {
  return (
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x200e ||
    code === 0x200f
  )
}

/** Line/paragraph separators, zero-width characters and the BOM (single-line values only). */
function isInvisible(code: number): boolean {
  return code === 0x2028 || code === 0x2029 || code === 0x200b || code === 0x2060 || code === 0xfeff
}

function sanitize(text: string, multiline: boolean): string {
  const normalized = multiline ? text.replace(/\r\n?/g, '\n') : text
  let out = ''
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0
    if (isControl(code, multiline) || isBidiControl(code)) continue
    if (!multiline && isInvisible(code)) continue
    out += ch
  }
  return out.trim()
}

/** True when an argv entry / URL string looks like one of our links (cheap pre-filter). */
export function isDeepLinkUrl(value: unknown): value is string {
  return typeof value === 'string' && value.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)
}

/** Parse and validate a raw `yardarm://` URL. */
export function parseDeepLink(raw: unknown): DeepLinkResult {
  if (typeof raw !== 'string' || raw.length === 0) return fail('The link is empty.')
  if (raw.length > DEEP_LINK_MAX_URL_LENGTH) return fail('The link is too long.')
  if (!isDeepLinkUrl(raw)) return fail('Not a yardarm:// link.')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail('The link is not a valid URL.')
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return fail('Not a yardarm:// link.')
  if (url.username || url.password || url.port) return fail('The link is not a valid URL.')
  if (url.pathname !== '' && url.pathname !== '/') {
    return fail('Unsupported link: only yardarm://new is available.')
  }
  if (url.hostname.toLowerCase() !== 'new') {
    return fail('Unsupported link: only yardarm://new is available.')
  }

  // Unknown parameters are ignored; a repeated known one is ambiguous → reject.
  const projects = url.searchParams.getAll('project')
  const prompts = url.searchParams.getAll('prompt')
  if (projects.length > 1 || prompts.length > 1) {
    return fail('The link repeats a parameter.')
  }
  const rawProject = projects[0] ?? ''
  const rawPrompt = prompts[0] ?? ''
  if (rawProject.length > DEEP_LINK_MAX_PROJECT_LENGTH) {
    return fail(
      `The project name in the link is longer than ${DEEP_LINK_MAX_PROJECT_LENGTH} characters.`
    )
  }
  if (rawPrompt.length > DEEP_LINK_MAX_PROMPT_LENGTH) {
    return fail(`The prompt in the link is longer than ${DEEP_LINK_MAX_PROMPT_LENGTH} characters.`)
  }

  const project = sanitize(rawProject, false)
  const prompt = sanitize(rawPrompt, true)
  return {
    ok: true,
    request: { action: 'new', project: project || null, prompt: prompt || null }
  }
}

/**
 * Resolve a link's project name against the known projects: exact name match,
 * case-insensitive, preferring a same-case match when several differ only by
 * case. Returns null when nothing matches — never a fuzzy guess.
 */
export function findProjectByName<T extends { name: string }>(
  projects: readonly T[],
  name: string
): T | null {
  const exact = projects.find((p) => p.name === name)
  if (exact) return exact
  const wanted = name.toLowerCase()
  return projects.find((p) => p.name.toLowerCase() === wanted) ?? null
}
