/**
 * AI-generated session insights: the prompt asking the chat's agent to
 * summarize the session as one ```session-insights fenced markdown block
 * (Outcome / What changed / Risks & follow-ups), the transcript marker for
 * that send, the lenient fence parser, and the completed-run detector
 * (findCompletedPrDraft style). Pure and shared — the Insights dialog sends
 * the prompt as a marker run and saves the parsed markdown on completion.
 */
import type { StoredMessage } from './ui-message'

/** Transcript marker line for an insights send. */
export const INSIGHTS_MARKER = 'Session insights'

/**
 * No-tools summarization prompt. The reply contract is a single fenced block
 * tagged `session-insights` holding markdown, so the parser never has to
 * guess which part of the prose is the deliverable.
 */
export function buildInsightsPrompt(): string {
  return `Summarize this session so far for the user. Base the summary only on the conversation above — do not run tools, read files, or do any new work.

Reply with exactly one fenced code block tagged session-insights containing markdown with these sections:

\`\`\`session-insights
## Outcome
<one short paragraph: what was asked for and where things stand now>

## What changed
<bullet list of concrete changes made (files, features, commits); "Nothing yet" if none>

## Risks & follow-ups
<bullet list of known risks, loose ends, or suggested next steps; "None" if none>
\`\`\`

No other text is needed outside the fenced block.`
}

/**
 * Parse the LAST ```session-insights fence in the text (agents sometimes
 * restate the template before the real answer). Lenient: tolerates text
 * around the fence and whitespace inside it; returns null when there is no
 * fence or it is empty.
 */
export function parseInsights(text: string): string | null {
  const fences = [...text.matchAll(/```session-insights[^\S\n]*\n([\s\S]*?)```/g)]
  const last = fences[fences.length - 1]
  if (!last) return null
  const body = last[1].trim()
  return body ? body : null
}

/**
 * The just-finished insights run, iff the last user message is the insights
 * marker and the agent produced something after it. `insights` is null when
 * the turn ended without a parsable block — the caller gates on the run
 * being idle, so that means the attempt failed. Returns null while nothing
 * follows the marker yet (run not started), and for non-insights last
 * messages. `markerId` lets the caller ignore a run that already existed
 * when the button was clicked.
 */
export function findCompletedInsights(
  messages: StoredMessage[]
): { markerId: string; insights: string | null } | null {
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = i
      break
    }
  }
  if (lastUser < 0) return null
  const markerPart = messages[lastUser].parts.find((p) => p.type === 'text' && p.marker)
  if (!markerPart || markerPart.type !== 'text' || markerPart.text !== INSIGHTS_MARKER) return null
  const after = messages.slice(lastUser + 1)
  if (after.length === 0) return null
  const text = after
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.parts)
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
  return { markerId: messages[lastUser].id, insights: parseInsights(text) }
}
