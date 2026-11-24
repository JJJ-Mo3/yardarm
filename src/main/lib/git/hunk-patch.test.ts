import { describe, expect, it } from 'vitest'
import {
  buildSingleHunkPatch,
  describeHunks,
  hunkHash,
  isRevertablePatch,
  parseFilePatch
} from './hunk-patch'

const THREE_HUNKS = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@',
  ' one',
  '+one and a half',
  ' two',
  ' three',
  ' four',
  '@@ -20,6 +21,5 @@ function mid() {',
  ' a',
  ' b',
  '-c',
  ' d',
  ' e',
  ' f',
  '@@ -40,3 +40,3 @@',
  ' x',
  '-y',
  '+Y',
  ' z',
  ''
].join('\n')

describe('parseFilePatch', () => {
  it('splits a multi-hunk patch into header and hunks', () => {
    const p = parseFilePatch(THREE_HUNKS)
    expect(p.fileCount).toBe(1)
    expect(p.headerLines).toHaveLength(4)
    expect(p.hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      [1, 4, 1, 5],
      [20, 6, 21, 5],
      [40, 3, 40, 3]
    ])
    expect(p.hunks[1].header).toBe('@@ -20,6 +21,5 @@ function mid() {')
    expect(isRevertablePatch(p)).toBe(true)
  })

  it('returns no hunks for empty output', () => {
    const p = parseFilePatch('')
    expect(p.hunks).toEqual([])
    expect(isRevertablePatch(p)).toBe(false)
  })

  it('does not split on body lines that look like hunk headers', () => {
    const text = [
      'diff --git a/x.diff b/x.diff',
      '--- a/x.diff',
      '+++ b/x.diff',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '+@@ -9,9 +9,9 @@ not a header',
      ' tail',
      ''
    ].join('\n')
    const p = parseFilePatch(text)
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0].lines).toHaveLength(4)
  })

  it('flags added files as not revertable per hunk', () => {
    const text = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..3b18e51',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+hello',
      '+world',
      ''
    ].join('\n')
    const p = parseFilePatch(text)
    expect(p.isNewFile).toBe(true)
    expect(p.hunks).toHaveLength(1)
    expect(isRevertablePatch(p)).toBe(false)
  })

  it('keeps deleted files revertable (the hunk restores the file)', () => {
    const text = [
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      'index 3b18e51..0000000',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-hello',
      '-world',
      ''
    ].join('\n')
    const p = parseFilePatch(text)
    expect(p.isDeletedFile).toBe(true)
    expect(isRevertablePatch(p)).toBe(true)
    expect(buildSingleHunkPatch(p, 0)).toBe(text)
    expect(describeHunks(p)[0]).toMatchObject({ anchorSide: 'old', anchorLine: 2, removed: 2 })
  })

  it('flags binary files', () => {
    const text = [
      'diff --git a/logo.png b/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/logo.png and b/logo.png differ',
      ''
    ].join('\n')
    const p = parseFilePatch(text)
    expect(p.isBinary).toBe(true)
    expect(isRevertablePatch(p)).toBe(false)
  })

  it('counts a second file section so type changes are rejected', () => {
    const text = [
      'diff --git a/link b/link',
      'deleted file mode 120000',
      '--- a/link',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-target',
      '\\ No newline at end of file',
      'diff --git a/link b/link',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/link',
      '@@ -0,0 +1 @@',
      '+content',
      ''
    ].join('\n')
    const p = parseFilePatch(text)
    expect(p.fileCount).toBe(2)
    expect(isRevertablePatch(p)).toBe(false)
  })
})

describe('describeHunks', () => {
  it('anchors each hunk at its last changed line', () => {
    const info = describeHunks(parseFilePatch(THREE_HUNKS))
    expect(info.map((h) => [h.anchorSide, h.anchorLine, h.added, h.removed])).toEqual([
      ['new', 2, 1, 0],
      // Pure deletion: anchored on the removed line's old number.
      ['old', 22, 0, 1],
      ['new', 41, 1, 1]
    ])
    expect(new Set(info.map((h) => h.hash)).size).toBe(3)
  })

  it('hashes by content, so an edited hunk no longer matches', () => {
    const a = parseFilePatch(THREE_HUNKS)
    const b = parseFilePatch(THREE_HUNKS.replace('+Y', '+YY'))
    expect(hunkHash(a.hunks[0])).toBe(hunkHash(b.hunks[0]))
    expect(hunkHash(a.hunks[2])).not.toBe(hunkHash(b.hunks[2]))
  })
})

describe('buildSingleHunkPatch', () => {
  const header = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts'
  ]

  it('builds the first, middle and last hunk with the file header', () => {
    const p = parseFilePatch(THREE_HUNKS)
    expect(buildSingleHunkPatch(p, 0)).toBe(
      [...header, '@@ -1,4 +1,5 @@', ' one', '+one and a half', ' two', ' three', ' four', ''].join(
        '\n'
      )
    )
    expect(buildSingleHunkPatch(p, 1)).toBe(
      [
        ...header,
        '@@ -20,6 +21,5 @@ function mid() {',
        ' a',
        ' b',
        '-c',
        ' d',
        ' e',
        ' f',
        ''
      ].join('\n')
    )
    expect(buildSingleHunkPatch(p, 2)).toBe(
      [...header, '@@ -40,3 +40,3 @@', ' x', '-y', '+Y', ' z', ''].join('\n')
    )
  })

  it('returns null for an out-of-range index', () => {
    const p = parseFilePatch(THREE_HUNKS)
    expect(buildSingleHunkPatch(p, 3)).toBeNull()
    expect(buildSingleHunkPatch(p, -1)).toBeNull()
  })

  it('keeps the no-newline-at-EOF marker with its hunk', () => {
    const text = [
      'diff --git a/n.txt b/n.txt',
      '--- a/n.txt',
      '+++ b/n.txt',
      '@@ -1,3 +1,3 @@',
      ' first',
      '-second',
      '+SECOND',
      ' third',
      '@@ -10,2 +10,2 @@',
      ' nine',
      '-last',
      '\\ No newline at end of file',
      '+LAST',
      '\\ No newline at end of file',
      ''
    ].join('\n')
    const p = parseFilePatch(text)
    expect(p.hunks).toHaveLength(2)
    expect(buildSingleHunkPatch(p, 1)).toBe(
      [
        'diff --git a/n.txt b/n.txt',
        '--- a/n.txt',
        '+++ b/n.txt',
        '@@ -10,2 +10,2 @@',
        ' nine',
        '-last',
        '\\ No newline at end of file',
        '+LAST',
        '\\ No newline at end of file',
        ''
      ].join('\n')
    )
    expect(describeHunks(p)[1]).toMatchObject({ anchorSide: 'new', anchorLine: 11 })
  })

  it('preserves CRLF line endings byte for byte', () => {
    const text = [
      'diff --git a/w.txt b/w.txt',
      '--- a/w.txt',
      '+++ b/w.txt',
      '@@ -1,3 +1,3 @@',
      ' one\r',
      '-two\r',
      '+TWO\r',
      ' three\r',
      ''
    ].join('\n')
    const p = parseFilePatch(text)
    expect(p.hunks[0].lines[2]).toBe('-two\r')
    expect(buildSingleHunkPatch(p, 0)).toBe(text)
  })

  it('drops mode-change lines from the header', () => {
    const text = [
      'diff --git a/run.sh b/run.sh',
      'old mode 100644',
      'new mode 100755',
      'index 1111111..2222222',
      '--- a/run.sh',
      '+++ b/run.sh',
      '@@ -1 +1 @@',
      '-echo a',
      '+echo b',
      ''
    ].join('\n')
    const built = buildSingleHunkPatch(parseFilePatch(text), 0) ?? ''
    expect(built).not.toContain('old mode')
    expect(built).not.toContain('new mode')
    expect(built).toContain('@@ -1 +1 @@\n-echo a\n+echo b\n')
  })
})
