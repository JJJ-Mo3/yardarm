/**
 * Follow-up suggestions: system-prompt guidance
 * asking the agent to end substantial replies with up to three one-line
 * "Follow-up: <next step>" markers, plus the lenient parser and strip helper
 * the renderer uses to turn them into clickable composer-prefill chips. Pure
 * and shared — the agent host injects the guidance, the renderer parses
 * transcripts. The UI must degrade to nothing when no marker is present.
 */

/** Maximum chips rendered per reply (extras are ignored, not an error). */
export const MAX_FOLLOW_UPS = 3

/**
 * Injected into pluginInstructions at host boot (beside the confidence
 * guidance) when the "Follow-up suggestions" preference is on. Kept short
 * and stable so it stays prefix-cache friendly.
 */
export const FOLLOW_UP_GUIDANCE =
  'After completing a substantial task, end your reply with one to three lines of the form ' +
  '"Follow-up: <short actionable next step>" suggesting what the user might ask for next ' +
  '(each under 15 words, concrete and specific to this project). Skip these lines entirely ' +
  'for trivial changes, questions, or purely informational replies.'

/**
 * Lenient one-line marker matcher: tolerates markdown bold, casing, :=–—-
 * separators, and blockquote/list prefixes. Payload capture stops at end of
 * line.
 */
const FOLLOW_UP_RE = /^[>\s*-]*(?:\*\*)?follow[- ]?ups?(?:\*\*)?\s*[:=\-–—]\s*(?:\*\*\s*)?(.+)$/i

/** A ``` or ~~~ fence delimiter line (markers inside code blocks are ignored). */
function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line)
}

/** Extract the payload if the line is a valid follow-up marker, else null. */
function matchFollowUp(line: string): string | null {
  const m = FOLLOW_UP_RE.exec(line)
  if (!m) return null
  const payload = m[1].replace(/\*\*\s*$/, '').trim()
  // Length floor guards against false positives like "Follow-up: none".
  return payload.length >= 8 ? payload : null
}

/** Parse follow-up markers outside code fences, capped at MAX_FOLLOW_UPS. */
export function parseFollowUps(text: string): string[] {
  let inFence = false
  const found: string[] = []
  for (const line of text.split('\n')) {
    if (isFenceLine(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const payload = matchFollowUp(line)
    if (payload && !found.includes(payload)) found.push(payload)
  }
  return found.slice(0, MAX_FOLLOW_UPS)
}

/** Remove follow-up marker lines (the chips replace them in the UI). */
export function stripFollowUpLines(text: string): string {
  if (parseFollowUps(text).length === 0) return text
  let inFence = false
  const kept = text.split('\n').filter((line) => {
    if (isFenceLine(line)) {
      inFence = !inFence
      return true
    }
    if (inFence) return true
    return matchFollowUp(line) === null
  })
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
