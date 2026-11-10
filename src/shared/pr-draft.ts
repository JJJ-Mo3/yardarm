/**
 * AI-drafted PR/MR descriptions: the prompt asking the chat's agent to study
 * the branch and reply with one ```pr-draft fenced JSON block, the transcript
 * marker for that send, the lenient fence/JSON parser, and the
 * completed-run detector (findCompletedReview style). Pure and shared — the
 * Changes view sends the prompt as a marker run and fills the Create PR form
 * from the parsed result; both fields stay editable, and a failed parse
 * surfaces an inline error without touching them.
 */
import type { StoredMessage } from './ui-message'

/** Transcript marker line for a PR-draft send. */
export const PR_DRAFT_MARKER = 'PR draft'

/**
 * Read-only investigation prompt. The reply contract is a single fenced
 * block tagged `pr-draft` holding JSON `{ title, body }` so the parser never
 * has to guess which part of the prose is the deliverable.
 */
export function buildPrDraftPrompt(baseBranch?: string): string {
  const diffStep = baseBranch
    ? `Run \`git log ${baseBranch}..HEAD --oneline\` and \`git diff ${baseBranch}...HEAD\` to see this branch's commits and changes.`
    : `Determine the base branch (check \`git symbolic-ref refs/remotes/origin/HEAD\`, falling back to main or master), then run \`git log <base>..HEAD --oneline\` and \`git diff <base>...HEAD\` to see this branch's commits and changes.`
  return `Draft a pull request title and description for the current branch. ${diffStep} This is a read-only task: do not commit, push, or modify any files.

Then reply with exactly one fenced code block tagged pr-draft containing JSON with this shape:

\`\`\`pr-draft
{ "title": "<imperative summary of the change, at most 70 characters>", "body": "<markdown description with a ## Summary section covering what changed and why, plus anything a reviewer should know>" }
\`\`\`

Base the title and body on the actual commits and diff — no guesses. No other text is needed outside the fenced block.`
}

export interface PrDraft {
  title: string
  body: string
}

/**
 * Parse the LAST ```pr-draft fence in the text (agents sometimes restate the
 * template before the real answer). Lenient: tolerates text around the
 * fence and whitespace inside it; returns null when there is no fence, the
 * JSON is malformed, or the title is missing/empty. Multi-line titles are
 * clamped to their first line.
 */
export function parsePrDraft(text: string): PrDraft | null {
  const fences = [...text.matchAll(/```pr-draft[^\S\n]*\n([\s\S]*?)```/g)]
  const last = fences[fences.length - 1]
  if (!last) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(last[1].trim())
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.title !== 'string') return null
  const title = obj.title.split('\n')[0].trim()
  if (!title) return null
  const body = typeof obj.body === 'string' ? obj.body.trim() : ''
  return { title, body }
}

/**
 * The just-finished draft, iff the last user message is the PR-draft marker
 * and the agent produced something after it. `draft` is null when the turn
 * ended without a parsable pr-draft block — the caller gates on the run
 * being idle, so that means the attempt failed. Returns null while nothing
 * follows the marker yet (run not started), and for non-draft last messages.
 * `markerId` lets the caller ignore a draft that already existed when the
 * button was clicked (an older draft run in the same transcript).
 */
export function findCompletedPrDraft(
  messages: StoredMessage[]
): { markerId: string; draft: PrDraft | null } | null {
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = i
      break
    }
  }
  if (lastUser < 0) return null
  const markerPart = messages[lastUser].parts.find((p) => p.type === 'text' && p.marker)
  if (!markerPart || markerPart.type !== 'text' || markerPart.text !== PR_DRAFT_MARKER) return null
  const after = messages.slice(lastUser + 1)
  if (after.length === 0) return null
  const text = after
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.parts)
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
  return { markerId: messages[lastUser].id, draft: parsePrDraft(text) }
}
