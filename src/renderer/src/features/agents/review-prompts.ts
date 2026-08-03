/**
 * Review prompt templates + transcript-marker helpers. The GitHub PR prompts
 * are based on the mastracode CLI's review command (mastracode dist
 * src/tui/commands/review.ts) with a Yardarm delivery note appended — agents
 * otherwise sometimes finish the tool work without ever writing the review as
 * their reply. The GitLab (glab) variants, the local-changes prompt, and the
 * follow-up prompts (post PR/MR comments, build a plan, share the review) are
 * Yardarm additions. Reviews are sent as "marker" messages — a compact muted
 * transcript line instead of a user bubble — and findCompletedReview derives
 * the post-review follow-up bar from the transcript alone.
 */
import type { RepoProvider } from '../../../../shared/ipc-types'
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
  const num = /^[#!]?(\d+)$/.exec(first)
  if (num) return { kind: 'pr', prNumber: num[1], focus: rest || undefined }
  return { kind: 'invalid' }
}

const FOCUS_SUFFIX = (focus: string): string => `\nPay special attention to: ${focus}\n`

/**
 * Appended as the final instruction of every review prompt: the agent's reply
 * is the deliverable. Without it, agents sometimes complete the investigation
 * and stop, or divert the write-up elsewhere — especially with verbosity
 * steering ("be concise") active.
 */
const REVIEW_DELIVERY_NOTE = (destination: string): string =>
  '\nWrite the complete review as your reply in this conversation — your reply is the ' +
  `review the user reads. Do not skip it, compress it to a one-liner, ${destination}, ` +
  'or write it to a file instead.\n'

export function buildPrListPrompt(provider: RepoProvider = 'github'): string {
  if (provider === 'gitlab') {
    return `List the open merge requests for this repository using \`glab mr list --per-page 20\`. Present them in a clear table with MR number, title, and author. Then ask me which MR I'd like you to review.`
  }
  return `List the open pull requests for this repository using \`gh pr list --limit 20\`. Present them in a clear table with PR number, title, and author. Then ask me which PR I'd like you to review.`
}

export function buildPrReviewPrompt(
  prNumber: string,
  provider: RepoProvider = 'github',
  focus?: string
): string {
  let prompt: string
  if (provider === 'gitlab') {
    prompt = `Do a thorough code review of MR !${prNumber}. Follow these steps:

1. Run \`glab mr view ${prNumber}\` to get the MR description and metadata.
2. Run \`glab mr diff ${prNumber}\` to get the full diff.
3. Run \`glab ci status --branch <source branch>\` (source branch from the MR view) to check pipeline status.
4. Read any relevant source files for full context on the changes.
5. Provide a detailed code review covering:
   - Overview of what the MR does
   - Root cause analysis (if it's a fix)
   - Code quality assessment
   - Potential concerns or edge cases
   - Pipeline status
   - Suggestions for improvement
   - Final verdict (approve/request changes/comment)
`
  } else {
    prompt = `Do a thorough code review of PR #${prNumber}. Follow these steps:

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
  }
  if (focus) prompt += FOCUS_SUFFIX(focus)
  prompt += REVIEW_DELIVERY_NOTE(
    provider === 'gitlab' ? 'post it only to the MR' : 'post it only to the PR'
  )
  return prompt
}

export type ReviewTarget = { kind: 'local' } | { kind: 'pr'; prNumber: string; title?: string }

/** Transcript marker line for a review send, e.g. `Review: PR #42 — fix auth`. */
export function buildReviewMarker(target: ReviewTarget, provider: RepoProvider = 'github'): string {
  if (target.kind === 'local') return 'Review: local changes'
  const ref = provider === 'gitlab' ? `MR !${target.prNumber}` : `PR #${target.prNumber}`
  return `Review: ${ref}${target.title ? ` — ${target.title}` : ''}`
}

/** Inverse of buildReviewMarker; null for non-review text (incl. follow-up markers). */
export function parseReviewMarker(
  text: string
): { kind: 'local' } | { kind: 'pr'; prNumber: string } | null {
  if (text === 'Review: local changes') return { kind: 'local' }
  const pr = /^Review: (?:PR #|MR !)(\d+)(?: — .*)?$/.exec(text)
  if (pr) return { kind: 'pr', prNumber: pr[1] }
  return null
}

/** Follow-up: post the review findings back to the PR/MR as comments. */
export function buildPrCommentsPrompt(
  provider: RepoProvider = 'github',
  prNumber?: string
): string {
  if (provider === 'gitlab') {
    const resolveStep = prNumber
      ? `The MR is !${prNumber}.`
      : `First resolve the MR for the current branch with \`glab mr view --output json\`.`
    return `Post the code review you just gave as comments on the merge request. ${resolveStep}

- Post the overall review with \`glab mr note create <number> --message <review>\` (do not approve — comment only).
- Keep the posted review concise: summarize the findings, keep concrete issues and suggestions, drop transcript-only narration.
- For specific issues tied to a file, you may add diff comments with \`glab mr note create <number> --file <path> --line <line> --message <text>\`.
- When done, report what was posted with a link to the MR.
`
  }
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

/** Nudge sent when a review turn ended without the agent writing the review. */
export function buildShareReviewPrompt(): string {
  return `You completed the review steps but your final reply did not include the review. Reply now with the complete detailed code review based on the work you just did — overview, code quality assessment, concerns and edge cases, suggestions for improvement, and a final verdict. Do not redo the investigation unless context is missing.`
}

/**
 * The just-finished review, iff the last user message is a review marker and
 * the agent produced something after it. `shared` is false when the agent
 * worked (tool calls etc.) but never wrote the review as reply text — the
 * caller gates on the run being idle, so that means the turn ended silently.
 * Returns null while nothing follows the marker yet (run not started), and
 * for non-review last messages, including follow-up markers, which
 * deliberately don't parse as reviews.
 */
export function findCompletedReview(messages: StoredMessage[]): {
  markerId: string
  target: { kind: 'local' } | { kind: 'pr'; prNumber: string }
  shared: boolean
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
  const after = messages.slice(lastUser + 1)
  if (after.length === 0) return null
  const shared = after.some(
    (m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'text' && p.text.trim())
  )
  return { markerId: messages[lastUser].id, target, shared }
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
  prompt += REVIEW_DELIVERY_NOTE('post it somewhere else')
  return prompt
}
