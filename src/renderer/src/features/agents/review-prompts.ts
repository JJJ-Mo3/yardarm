/**
 * Review prompt templates + transcript-marker helpers. The PR prompts mirror
 * the mastracode CLI's review command byte-for-byte (mastracode dist
 * src/tui/commands/review.ts) so Yardarm reviews behave identically; the
 * local-changes prompt and the follow-up prompts (post PR comments, build a
 * plan) are Yardarm additions. Reviews are sent as "marker" messages — a
 * compact muted transcript line instead of a user bubble — and
 * findCompletedReview derives the post-review follow-up bar from the
 * transcript alone.
 */
import type { StoredMessage } from '../../../../shared/ui-message'

export type ReviewArgs =
  | { kind: 'list' }
  | { kind: 'pr'; prNumber: string; focus?: string }
  | { kind: 'changes'; focus?: string }
  | { kind: 'invalid' }

/** Parse `/review` args: empty → list, `changes [focus]`, `<number> [focus]`. */
export function parseReviewArgs(args: string): ReviewArgs {
  const trimmed = args.trim()
  if (!trimmed) return { kind: 'list' }
  const first = trimmed.split(/\s+/)[0]
  const rest = trimmed.slice(first.length).trim()
  if (first === 'changes') return { kind: 'changes', focus: rest || undefined }
  const num = /^#?(\d+)$/.exec(first)
  if (num) return { kind: 'pr', prNumber: num[1], focus: rest || undefined }
  return { kind: 'invalid' }
}

const FOCUS_SUFFIX = (focus: string): string => `\nPay special attention to: ${focus}\n`

export function buildPrListPrompt(): string {
  return `List the open pull requests for this repository using \`gh pr list --limit 20\`. Present them in a clear table with PR number, title, and author. Then ask me which PR I'd like you to review.`
}

export function buildPrReviewPrompt(prNumber: string, focus?: string): string {
  let prompt = `Do a thorough code review of PR #${prNumber}. Follow these steps:

1. Run \`gh pr view ${prNumber}\` to get the PR description and metadata.
2. Run \`gh pr diff ${prNumber}\` to get the full diff.
3. Run \`gh pr checks ${prNumber}\` to check CI status.
4. Read any relevant source files for full context on the changes.
5. Provide a detailed code review covering:
   - Overview of what the PR does
   - Root cause analysis (if it's a fix)
   - Code quality assessment
   - Potential concerns or edge cases
   - CI status
   - Suggestions for improvement
   - Final verdict (approve/request changes/comment)
`
  if (focus) prompt += FOCUS_SUFFIX(focus)
  return prompt
}

export type ReviewTarget = { kind: 'local' } | { kind: 'pr'; prNumber: string; title?: string }

/** Transcript marker line for a review send, e.g. `Review: PR #42 — fix auth`. */
export function buildReviewMarker(target: ReviewTarget): string {
  if (target.kind === 'local') return 'Review: local changes'
  return `Review: PR #${target.prNumber}${target.title ? ` — ${target.title}` : ''}`
}

/** Inverse of buildReviewMarker; null for non-review text (incl. follow-up markers). */
export function parseReviewMarker(
  text: string
): { kind: 'local' } | { kind: 'pr'; prNumber: string } | null {
  if (text === 'Review: local changes') return { kind: 'local' }
  const pr = /^Review: PR #(\d+)(?: — .*)?$/.exec(text)
  if (pr) return { kind: 'pr', prNumber: pr[1] }
  return null
}

/** Follow-up: post the review findings back to the PR as comments. */
export function buildPrCommentsPrompt(prNumber?: string): string {
  const resolveStep = prNumber
    ? `The PR is #${prNumber}.`
    : `First resolve the PR for the current branch with \`gh pr view --json number\`.`
  return `Post the code review you just gave as comments on the pull request. ${resolveStep}

- Post the overall review with \`gh pr review <number> --comment --body <review>\` (do not approve or request changes — comment only).
- Keep the posted review concise: summarize the findings, keep concrete issues and suggestions, drop transcript-only narration.
- For specific issues tied to a file, you may add individual comments with \`gh pr comment <number> --body <text>\` referencing the file and line.
- When done, report what was posted with a link to the PR.
`
}

/** Follow-up: turn the review findings into a concrete implementation plan. */
export function buildPlanFromReviewPrompt(): string {
  return `Turn the findings from the code review you just gave into a concrete implementation plan. For each issue worth fixing, list the file(s) involved and the specific change to make, ordered by priority. Skip nitpicks that aren't worth the churn. Present the plan for approval.`
}

/**
 * The just-finished review, iff the last user message is a review marker and
 * an assistant reply with text follows it. Returns null otherwise — including
 * for follow-up markers, which deliberately don't parse as reviews.
 */
export function findCompletedReview(messages: StoredMessage[]): {
  markerId: string
  target: { kind: 'local' } | { kind: 'pr'; prNumber: string }
} | null {
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = i
      break
    }
  }
  if (lastUser < 0) return null
  const markerPart = messages[lastUser].parts.find((p) => p.type === 'text' && p.marker)
  if (!markerPart || markerPart.type !== 'text') return null
  const target = parseReviewMarker(markerPart.text)
  if (!target) return null
  const replied = messages
    .slice(lastUser + 1)
    .some((m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'text' && p.text.trim()))
  return replied ? { markerId: messages[lastUser].id, target } : null
}

export function buildLocalReviewPrompt(opts?: { baseBranch?: string; focus?: string }): string {
  const diffStep = opts?.baseBranch
    ? `Run \`git diff ${opts.baseBranch}...HEAD\` to see committed work on this branch, and \`git diff HEAD\` for uncommitted changes. Review both.`
    : `Determine the base branch (check \`git symbolic-ref refs/remotes/origin/HEAD\`, falling back to main or master), then run \`git diff <base>...HEAD\` to see committed work on this branch, and \`git diff HEAD\` for uncommitted changes. Review both.`
  let prompt = `Do a thorough code review of the local changes in this working tree. Follow these steps:

1. Run \`git status\` to see staged, unstaged, and untracked files.
2. ${diffStep}
3. Read any relevant source files for full context on the changes.
4. Provide a detailed code review covering:
   - Overview of what the changes do
   - Code quality assessment
   - Potential concerns, bugs, or edge cases
   - Suggestions for improvement
   - Final verdict (ready to ship / needs work)
`
  if (opts?.focus) prompt += FOCUS_SUFFIX(opts.focus)
  return prompt
}
