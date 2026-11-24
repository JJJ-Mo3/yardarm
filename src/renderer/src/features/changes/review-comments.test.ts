import { describe, expect, it } from 'vitest'
import {
  buildReviewCommentsPrompt,
  extractLines,
  lineLabel,
  sortComments,
  type ReviewComment
} from './review-comments'

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'c1',
  path: 'src/a.ts',
  side: 'new',
  startLine: 3,
  endLine: 3,
  code: 'const a = 1',
  text: 'Rename this',
  ...over
})

describe('extractLines', () => {
  const content = 'one\ntwo\nthree\nfour\n'

  it('returns an inclusive 1-based range', () => {
    expect(extractLines(content, 2, 3)).toBe('two\nthree')
    expect(extractLines(content, 4, 4)).toBe('four')
  })

  it('clamps to the file and tolerates reversed ranges', () => {
    expect(extractLines(content, 3, 99)).toBe('three\nfour')
    expect(extractLines(content, 3, 2)).toBe('two\nthree')
    expect(extractLines(content, 9, 12)).toBe('')
    expect(extractLines('', 1, 1)).toBe('')
  })

  it('handles CRLF and a missing final newline', () => {
    expect(extractLines('a\r\nb\r\nc', 2, 3)).toBe('b\nc')
  })
})

describe('lineLabel', () => {
  it('labels single lines, ranges and removed code', () => {
    expect(lineLabel({ side: 'new', startLine: 5, endLine: 5 })).toBe('line 5')
    expect(lineLabel({ side: 'new', startLine: 5, endLine: 9 })).toBe('lines 5–9')
    expect(lineLabel({ side: 'old', startLine: 2, endLine: 2 })).toBe('removed line 2')
  })
})

describe('sortComments', () => {
  it('orders by file then position without mutating the input', () => {
    const input = [
      comment({ id: 'x', path: 'src/b.ts', startLine: 1, endLine: 1 }),
      comment({ id: 'y', startLine: 9, endLine: 9 }),
      comment({ id: 'z', startLine: 2, endLine: 4 })
    ]
    expect(sortComments(input).map((c) => c.id)).toEqual(['z', 'y', 'x'])
    expect(input.map((c) => c.id)).toEqual(['x', 'y', 'z'])
  })
})

describe('buildReviewCommentsPrompt', () => {
  it('returns an empty string without comments', () => {
    expect(buildReviewCommentsPrompt([])).toBe('')
  })

  it('formats a single comment with path, line, code and text', () => {
    expect(buildReviewCommentsPrompt([comment({})])).toBe(
      [
        'I reviewed the current changes and left a comment. It names the file and lines it refers to and quotes the code.',
        '',
        'src/a.ts — line 3',
        '```',
        'const a = 1',
        '```',
        'Comment: Rename this',
        '',
        'Please address it. If you disagree or it cannot be applied, say why instead of silently skipping it.'
      ].join('\n')
    )
  })

  it('numbers several comments across files in reading order', () => {
    const prompt = buildReviewCommentsPrompt([
      comment({
        id: 'b',
        path: 'src/z.ts',
        startLine: 10,
        endLine: 12,
        code: 'x\ny\nz',
        text: 'B'
      }),
      comment({ id: 'a', text: '  A  ' })
    ])
    expect(prompt).toContain('left 2 comments')
    expect(prompt.indexOf('1. src/a.ts — line 3')).toBeGreaterThan(-1)
    expect(prompt.indexOf('2. src/z.ts — lines 10–12')).toBeGreaterThan(
      prompt.indexOf('1. src/a.ts — line 3')
    )
    expect(prompt).toContain('```\nx\ny\nz\n```\nComment: B')
    expect(prompt).toContain('Comment: A\n')
    expect(prompt).toContain('Please address every comment.')
  })

  it('marks comments on removed code', () => {
    const prompt = buildReviewCommentsPrompt([comment({ side: 'old', startLine: 4, endLine: 5 })])
    expect(prompt).toContain(
      'src/a.ts — removed lines 4–5 (numbering of the version before the change)'
    )
  })

  it('uses a fence longer than any backtick run in the code', () => {
    const prompt = buildReviewCommentsPrompt([comment({ code: 'const md = "```ts"' })])
    expect(prompt).toContain('````\nconst md = "```ts"\n````')
  })

  it('omits the code block when there is no code and truncates long quotes', () => {
    expect(buildReviewCommentsPrompt([comment({ code: '  ' })])).not.toContain('```')
    const long = Array.from({ length: 45 }, (_, i) => `l${i + 1}`).join('\n')
    const prompt = buildReviewCommentsPrompt([comment({ code: long })])
    expect(prompt).toContain('l40\n… (5 more lines)\n```')
    expect(prompt).not.toContain('l41')
  })
})
