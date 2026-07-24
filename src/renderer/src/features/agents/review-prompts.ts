/**
 * /review prompt templates. The PR prompts mirror the mastracode CLI's
 * review command byte-for-byte (mastracode dist src/tui/commands/review.ts)
 * so Yardarm reviews behave identically; the local-changes prompt is a
 * Yardarm addition for worktree branches that haven't opened a PR yet.
 */

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
