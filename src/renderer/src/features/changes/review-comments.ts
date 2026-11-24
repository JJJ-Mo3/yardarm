/**
 * Draft review comments for the Changes tab: the comment shape, helpers for
 * quoting the commented lines, and the formatter that turns every draft into
 * ONE prompt for the agent (file path, line range, quoted code, comment).
 * Pure — the per-chat draft store lives in review-comments-atom.ts.
 */

export type CommentSide = 'old' | 'new'

/** A 1-based inclusive line range on one side of a diff. */
export interface LineRange {
  side: CommentSide
  startLine: number
  endLine: number
}

export interface ReviewComment extends LineRange {
  id: string
  /** Worktree-relative file path. */
  path: string
  /** The commented lines as they appeared when the comment was written. */
  code: string
  text: string
}

/** Quoted code longer than this is cut (the agent can read the file for the rest). */
const MAX_QUOTED_LINES = 40

/** Lines `startLine..endLine` (1-based, inclusive) of `content`, clamped to the file. */
export function extractLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n')
  // A trailing newline is a terminator, not an extra empty line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const from = Math.max(1, Math.min(startLine, endLine))
  const to = Math.min(lines.length, Math.max(startLine, endLine))
  if (from > to) return ''
  return lines
    .slice(from - 1, to)
    .map((l) => l.replace(/\r$/, ''))
    .join('\n')
}

/** "line 12" / "lines 12–14", marked when it refers to removed code. */
export function lineLabel(range: LineRange): string {
  const span =
    range.startLine === range.endLine
      ? `line ${range.startLine}`
      : `lines ${range.startLine}–${range.endLine}`
  return range.side === 'old' ? `removed ${span}` : span
}

/** Backtick fence longer than any backtick run in `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function quoted(code: string): string {
  const lines = code.split('\n')
  if (lines.length <= MAX_QUOTED_LINES) return code
  const cut = lines.length - MAX_QUOTED_LINES
  return [
    ...lines.slice(0, MAX_QUOTED_LINES),
    `… (${cut} more ${cut === 1 ? 'line' : 'lines'})`
  ].join('\n')
}

/** Drafts ordered for reading: by file, then by position (new-side before removed code). */
export function sortComments(comments: ReviewComment[]): ReviewComment[] {
  return [...comments].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.startLine - b.startLine ||
      a.endLine - b.endLine ||
      (a.side === b.side ? 0 : a.side === 'new' ? -1 : 1)
  )
}

/**
 * One prompt carrying every draft comment. Returns '' when there are none.
 * Comments on removed code say so, since their line numbers refer to the
 * previous version of the file.
 */
export function buildReviewCommentsPrompt(comments: ReviewComment[]): string {
  if (comments.length === 0) return ''
  const sorted = sortComments(comments)
  const many = sorted.length > 1
  const out: string[] = [
    many
      ? `I reviewed the current changes and left ${sorted.length} comments. Each names the file and lines it refers to and quotes the code.`
      : 'I reviewed the current changes and left a comment. It names the file and lines it refers to and quotes the code.',
    ''
  ]
  sorted.forEach((c, i) => {
    const where =
      c.side === 'old'
        ? `${c.path} — ${lineLabel(c)} (numbering of the version before the change)`
        : `${c.path} — ${lineLabel(c)}`
    out.push(many ? `${i + 1}. ${where}` : where)
    if (c.code.trim()) {
      const code = quoted(c.code)
      const fence = fenceFor(code)
      out.push(fence, code, fence)
    }
    out.push(`Comment: ${c.text.trim()}`, '')
  })
  out.push(
    many
      ? 'Please address every comment. Where you disagree with one or it cannot be applied, say why instead of silently skipping it.'
      : 'Please address it. If you disagree or it cannot be applied, say why instead of silently skipping it.'
  )
  return out.join('\n')
}
