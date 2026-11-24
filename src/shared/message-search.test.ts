import { describe, expect, it } from 'vitest'
import {
  SEARCH_BODY_MAX,
  SEARCH_MAX_TERMS,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  buildFtsQuery,
  extractSearchText,
  highlightTerm,
  splitSnippet
} from './message-search'

describe('extractSearchText', () => {
  it('indexes only text parts of user and assistant messages', () => {
    const parts = [
      { type: 'reasoning', text: 'secret thoughts' },
      { type: 'text', text: 'Renamed the helper.' },
      { type: 'tool-call', toolCallId: 't', toolName: 'shell', args: {}, result: 'tool output' },
      { type: 'info', level: 'info', text: 'Auto-continued' },
      { type: 'text', text: 'Done.' }
    ]
    expect(extractSearchText('assistant', parts)).toBe('Renamed the helper.\nDone.')
    expect(extractSearchText('user', [{ type: 'text', text: '  fix the bug  ' }])).toBe(
      'fix the bug'
    )
  })

  it('returns an empty string for other roles and malformed parts', () => {
    expect(extractSearchText('system', [{ type: 'text', text: 'x' }])).toBe('')
    expect(extractSearchText('user', 'nope')).toBe('')
    expect(extractSearchText('user', [null, 3, { type: 'text' }, { type: 'text', text: 7 }])).toBe(
      ''
    )
  })

  it('strips agent marker lines from assistant replies but keeps user text verbatim', () => {
    const reply = 'All tests pass.\nConfidence: green — verified by running the suite'
    const indexed = extractSearchText('assistant', [{ type: 'text', text: reply }])
    expect(indexed).toContain('All tests pass.')
    expect(indexed).not.toContain('Confidence: green')
    expect(extractSearchText('user', [{ type: 'text', text: reply }])).toBe(reply)
  })

  it('caps the indexed length and removes snippet control characters', () => {
    const long = 'a'.repeat(SEARCH_BODY_MAX + 500)
    expect(extractSearchText('user', [{ type: 'text', text: long }])).toHaveLength(SEARCH_BODY_MAX)
    expect(
      extractSearchText('user', [{ type: 'text', text: `x${SNIPPET_OPEN}y${SNIPPET_CLOSE}z` }])
    ).toBe('x y z')
  })
})

describe('buildFtsQuery', () => {
  it('quotes every term and prefix-matches the last one', () => {
    expect(buildFtsQuery('rollback checkpoint')).toBe('"rollback" "checkpoint"*')
    expect(buildFtsQuery('  wörld  ')).toBe('"wörld"*')
  })

  it('returns null when nothing is searchable', () => {
    expect(buildFtsQuery('')).toBeNull()
    expect(buildFtsQuery('   ')).toBeNull()
    expect(buildFtsQuery('"" -- * ()')).toBeNull()
  })

  it('neutralizes FTS syntax instead of passing it through', () => {
    expect(buildFtsQuery('foo OR bar')).toBe('"foo" "OR" "bar"*')
    expect(buildFtsQuery('body:secret NEAR(x y)')).toBe('"body:secret" "NEAR(x" "y)"*')
    expect(buildFtsQuery('say "hello" there')).toBe('"say" "hello" "there"*')
    expect(buildFtsQuery('a"b')).toBe('"a" "b"*')
    expect(buildFtsQuery('x* -y ^z')).toBe('"x*" "-y" "^z"*')
  })

  it('never emits an unbalanced or embedded double quote', () => {
    for (const input of ['"', '"""', 'a " b', '"; DROP TABLE messages; --', 'tab\tnew\nline"']) {
      const q = buildFtsQuery(input)
      if (q === null) continue
      const stripped = q.replace(/"[^"]*"\*?/g, '').trim()
      expect(stripped).toBe('')
    }
  })

  it('bounds the number of terms', () => {
    const q = buildFtsQuery(Array.from({ length: 40 }, (_, i) => `t${i}`).join(' '))
    expect(q?.split(' ')).toHaveLength(SEARCH_MAX_TERMS)
  })
})

describe('highlightTerm', () => {
  it('picks the longest term without surrounding punctuation', () => {
    expect(highlightTerm('fix (checkpoint) bug')).toBe('checkpoint')
    expect(highlightTerm('"quoted"')).toBe('quoted')
    expect(highlightTerm('--')).toBe('')
  })
})

describe('splitSnippet', () => {
  it('splits marked matches from plain text', () => {
    const s = `…the ${SNIPPET_OPEN}rollback${SNIPPET_CLOSE} restores ${SNIPPET_OPEN}files${SNIPPET_CLOSE}…`
    expect(splitSnippet(s)).toEqual([
      { text: '…the ', hit: false },
      { text: 'rollback', hit: true },
      { text: ' restores ', hit: false },
      { text: 'files', hit: true },
      { text: '…', hit: false }
    ])
  })

  it('tolerates snippets without or with unbalanced markers', () => {
    expect(splitSnippet('plain')).toEqual([{ text: 'plain', hit: false }])
    expect(splitSnippet(`a${SNIPPET_OPEN}b`)).toEqual([{ text: 'ab', hit: false }])
    expect(splitSnippet('')).toEqual([])
  })
})
