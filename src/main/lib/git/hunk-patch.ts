/**
 * Pure unified-diff helpers behind per-hunk revert: parse the `git diff`
 * output for ONE file into its header + hunks, describe each hunk for the
 * renderer (where to anchor the action, a content hash for stale checks), and
 * rebuild a single-hunk patch that `git apply -R` can take.
 *
 * Text is handled as an opaque byte string (callers decode git's output as
 * latin1) and split on "\n" only, so CR characters, non-UTF-8 bytes and the
 * "\ No newline at end of file" marker round-trip untouched.
 */
import { createHash } from 'node:crypto'

export interface ParsedHunk {
  /** The full `@@ -a,b +c,d @@ …` line. */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Header plus body lines, without trailing newlines. */
  lines: string[]
}

export interface ParsedFilePatch {
  /** Everything before the first hunk (`diff --git`, mode lines, `---`/`+++`). */
  headerLines: string[]
  hunks: ParsedHunk[]
  /** Number of `diff --git` sections (anything but 1 is not a single-file patch). */
  fileCount: number
  isNewFile: boolean
  isDeletedFile: boolean
  isBinary: boolean
}

/** What the renderer needs to offer "Revert this change" for one hunk. */
export interface HunkInfo {
  index: number
  /** Content hash; sent back on revert so a stale view can't revert something else. */
  hash: string
  header: string
  /** Side + 1-based line of the hunk's last changed line (where the action is shown). */
  anchorSide: 'old' | 'new'
  anchorLine: number
  added: number
  removed: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parse the diff of a single file. Tolerates empty input (no hunks). */
export function parseFilePatch(text: string): ParsedFilePatch {
  const lines = text.split('\n')
  // A trailing newline leaves one empty element — not a diff line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const headerLines: string[] = []
  const hunks: ParsedHunk[] = []
  let fileCount = 0
  let i = 0
  while (i < lines.length && !HUNK_HEADER.test(lines[i])) {
    if (lines[i].startsWith('diff --git ')) fileCount++
    headerLines.push(lines[i])
    i++
  }
  while (i < lines.length) {
    const m = HUNK_HEADER.exec(lines[i])
    if (!m) {
      // A second file section (e.g. a type change) — count it and stop.
      if (lines[i].startsWith('diff --git ')) fileCount++
      i++
      continue
    }
    const oldLines = m[2] === undefined ? 1 : Number(m[2])
    const newLines = m[4] === undefined ? 1 : Number(m[4])
    const hunk: ParsedHunk = {
      header: lines[i],
      oldStart: Number(m[1]),
      oldLines,
      newStart: Number(m[3]),
      newLines,
      lines: [lines[i]]
    }
    i++
    let seenOld = 0
    let seenNew = 0
    // Consume by the header's counts, so body lines that merely look like
    // headers can never split a hunk.
    while (i < lines.length && (seenOld < oldLines || seenNew < newLines)) {
      const c = lines[i][0]
      if (c === '+') seenNew++
      else if (c === '-') seenOld++
      else if (c !== '\\') {
        seenOld++
        seenNew++
      }
      hunk.lines.push(lines[i])
      i++
    }
    while (i < lines.length && lines[i].startsWith('\\')) {
      hunk.lines.push(lines[i])
      i++
    }
    hunks.push(hunk)
  }
  return {
    headerLines,
    hunks,
    fileCount,
    isNewFile: headerLines.some((l) => l.startsWith('new file mode ')),
    isDeletedFile: headerLines.some((l) => l.startsWith('deleted file mode ')),
    isBinary: headerLines.some((l) => l.startsWith('Binary files ') || l === 'GIT binary patch')
  }
}

/**
 * Whether hunks of this patch can be reverted one at a time: a single text
 * file that already exists at the base (reverting a brand-new file's only
 * hunk would just delete it — that is what Discard is for).
 */
export function isRevertablePatch(patch: ParsedFilePatch): boolean {
  return patch.fileCount === 1 && !patch.isNewFile && !patch.isBinary && patch.hunks.length > 0
}

/** Stable short hash of a hunk's exact content. */
export function hunkHash(hunk: ParsedHunk): string {
  return createHash('sha1').update(hunk.lines.join('\n'), 'latin1').digest('hex').slice(0, 16)
}

/** Renderer-facing description of each hunk. */
export function describeHunks(patch: ParsedFilePatch): HunkInfo[] {
  return patch.hunks.map((hunk, index) => {
    let oldNo = hunk.oldStart - 1
    let newNo = hunk.newStart - 1
    let added = 0
    let removed = 0
    let anchorSide: 'old' | 'new' = 'new'
    let anchorLine = Math.max(1, hunk.newStart)
    for (const line of hunk.lines.slice(1)) {
      const c = line[0]
      if (c === '\\') continue
      if (c === '+') {
        newNo++
        added++
        anchorSide = 'new'
        anchorLine = newNo
      } else if (c === '-') {
        oldNo++
        removed++
        anchorSide = 'old'
        anchorLine = oldNo
      } else {
        oldNo++
        newNo++
      }
    }
    return {
      index,
      hash: hunkHash(hunk),
      header: hunk.header,
      anchorSide,
      anchorLine,
      added,
      removed
    }
  })
}

/**
 * A patch containing only hunk `index`, with the original file header. Mode
 * changes are dropped from the header so reverting a hunk never also flips
 * the file's mode. Returns null when the index is out of range.
 */
export function buildSingleHunkPatch(patch: ParsedFilePatch, index: number): string | null {
  const hunk = patch.hunks[index]
  if (!hunk) return null
  const header = patch.headerLines.filter(
    (l) => !l.startsWith('old mode ') && !l.startsWith('new mode ')
  )
  return [...header, ...hunk.lines].join('\n') + '\n'
}
