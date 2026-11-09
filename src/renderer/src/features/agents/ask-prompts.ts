/**
 * /ask prompt + marker builders: read-only codebase Q&A. The prompt steers
 * the agent to investigate without modifying anything and to cite every
 * claim as an inline-code `path:line` reference, which the chat markdown
 * linkifies into Files-tab deep links. Sent as a marker message (compact
 * muted transcript line) like /review; the delivery note mirrors the review
 * module's — agents otherwise sometimes finish the investigation without
 * writing the answer as their reply.
 */

const MARKER_MAX = 80

/** Transcript marker line for an ask send, e.g. `Ask: how does rollback work?`. */
export function buildAskMarker(question: string): string {
  const q = question.trim().replace(/\s+/g, ' ')
  return `Ask: ${q.length > MARKER_MAX ? `${q.slice(0, MARKER_MAX - 1)}…` : q}`
}

export function buildAskPrompt(question: string): string {
  return `Answer this question about the codebase: ${question}

This is a read-only investigation:
- Do not create, modify, or delete any files.
- Do not run commands that change state (no installs, no builds that write artifacts, no git commands that mutate the repo). Searching the code and reading files is fine.
- Investigate as deeply as needed: search for the relevant code, read the files involved, and trace the behavior end to end before answering.

In your answer, cite the source for every claim as an inline code span containing the repo-relative path and line, like \`src/main/index.ts:42\` (or \`path:start-end\` for a range). Only cite locations you actually read — never guess paths or line numbers.

Write the complete answer as your reply in this conversation — your reply is the answer the user reads. Do not skip it, compress it to a one-liner, or write it to a file instead.
`
}
