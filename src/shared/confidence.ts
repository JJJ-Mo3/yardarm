/**
 * Confidence ratings: system-prompt guidance asking the agent
 * to emit a one-line CONFIDENCE marker, plus the lenient parser the renderer
 * uses to surface it as a chip inline on the rated reply and on plan cards.
 * Pure and shared — the agent host injects the guidance, the renderer parses
 * transcripts. The UI must degrade to nothing when the marker is absent
 * (weaker models may never emit it).
 */
export type ConfidenceLevel = 'green' | 'yellow' | 'red'

export interface ConfidenceInfo {
  level: ConfidenceLevel
  reason: string
}

/**
 * Stable prefix shared by every historical wording of the guidance below —
 * the agent host removes stale entries by this prefix (not exact match), so
 * rewording the guidance still clears variants persisted by earlier boots.
 */
export const CONFIDENCE_GUIDANCE_PREFIX =
  'When you start working on a new task, include a single line of the form ' +
  '"CONFIDENCE: green|yellow|red'

/**
 * Injected into the SDK's pluginInstructions state at host boot (beside the
 * ask_user guidance). Kept short and stable so it stays prefix-cache
 * friendly.
 */
export const CONFIDENCE_GUIDANCE =
  CONFIDENCE_GUIDANCE_PREFIX +
  ' — <one short sentence why>" in your first reply after ' +
  'analyzing it, rating how confident you are that you can complete the task as understood ' +
  '(green = clear requirements and approach, yellow = some uncertainty, red = significant ' +
  'unknowns). Include the same line in any plan you submit. When your confidence is yellow ' +
  'or red, ask clarifying questions first (use the ask_user tool when available) to raise ' +
  'it before making changes. Emit a fresh rating for every new task the user gives you, and ' +
  're-emit mid-task whenever your confidence changes.'

/**
 * Lenient one-line marker matcher: tolerates markdown bold, "Confidence"
 * casing, :=–—- separators, an optional traffic-light emoji, and a missing
 * reason. The reason capture stops at the end of the line.
 */
const MARKER_RE =
  /^[>\s]*(?:\*\*)?confidence(?:\*\*)?\s*[:=\-–—]\s*(?:\*\*)?\s*(?:[🟢🟡🔴]\s*)?(?:\*\*)?(green|yellow|red)(?:\*\*)?\b[\s.:,—–-]*(.*)$/imu

/** Parse the first CONFIDENCE marker in a block of text, if any. */
export function parseConfidenceMarker(text: string): ConfidenceInfo | null {
  const m = MARKER_RE.exec(text)
  if (!m) return null
  const reason = (m[2] ?? '').replace(/\*\*\s*$/, '').trim()
  return { level: m[1].toLowerCase() as ConfidenceLevel, reason }
}

/** Remove the CONFIDENCE marker line (the chip replaces it in the UI). */
export function stripConfidenceLine(text: string): string {
  if (!MARKER_RE.test(text)) return text
  return text
    .split('\n')
    .filter((line) => !MARKER_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
