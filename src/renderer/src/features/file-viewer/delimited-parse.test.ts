import { describe, expect, it } from 'vitest'
import { altViewKindFor, delimiterFor, parseDelimited } from './delimited-parse'

describe('altViewKindFor', () => {
  it('maps extensions to alternate views', () => {
    expect(altViewKindFor('docs/README.md')).toBe('markdown')
    expect(altViewKindFor('notes.MARKDOWN')).toBe('markdown')
    expect(altViewKindFor('page.mdx')).toBe('markdown')
    expect(altViewKindFor('data/rows.csv')).toBe('table')
    expect(altViewKindFor('rows.TSV')).toBe('table')
    expect(altViewKindFor('logo.svg')).toBe('image')
  })

  it('returns null otherwise', () => {
    expect(altViewKindFor('index.ts')).toBeNull()
    expect(altViewKindFor('md')).toBeNull()
    expect(altViewKindFor('.csv')).toBeNull()
    expect(altViewKindFor('a.csv/b.txt')).toBeNull()
  })
})

describe('delimiterFor', () => {
  it('uses tabs for .tsv and commas otherwise', () => {
    expect(delimiterFor('a.tsv')).toBe('\t')
    expect(delimiterFor('a.TSV')).toBe('\t')
    expect(delimiterFor('a.csv')).toBe(',')
  })
})

describe('parseDelimited', () => {
  it('parses plain rows with and without a trailing newline', () => {
    expect(parseDelimited('a,b,c\n1,2,3\n').rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3']
    ])
    expect(parseDelimited('a,b\n1,2').rows).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('handles CRLF and lone CR row ends', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(parseDelimited('a,b\r1,2').rows).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('handles quoted fields with embedded delimiters, quotes and newlines', () => {
    const t = parseDelimited('name,note\n"Smith, J","said ""hi""\r\nthen left"\nx,y\n')
    expect(t.rows).toEqual([
      ['name', 'note'],
      ['Smith, J', 'said "hi"\r\nthen left'],
      ['x', 'y']
    ])
    expect(t.columnCount).toBe(2)
    expect(t.truncatedRows).toBe(false)
  })

  it('keeps empty fields, including trailing and quoted-empty ones', () => {
    expect(parseDelimited('a,,c\n,,\n""\n').rows).toEqual([['a', '', 'c'], ['', '', ''], ['']])
  })

  it('skips blank lines and a leading BOM', () => {
    expect(parseDelimited('﻿a,b\n\n\r\n1,2\n\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(parseDelimited('').rows).toEqual([])
    expect(parseDelimited('\n\n').rows).toEqual([])
  })

  it('is lenient with stray and unterminated quotes', () => {
    expect(parseDelimited('5" pipe,ok\n').rows).toEqual([['5" pipe', 'ok']])
    expect(parseDelimited('"ab"cd,e\n').rows).toEqual([['abcd', 'e']])
    expect(parseDelimited('a,"never closed\nstill,here').rows).toEqual([
      ['a', 'never closed\nstill,here']
    ])
  })

  it('parses tab-separated text, leaving commas alone', () => {
    expect(parseDelimited('a\tb,c\n1\t"2\t3"\n', '\t').rows).toEqual([
      ['a', 'b,c'],
      ['1', '2\t3']
    ])
  })

  it('caps rows and reports truncation only when more content exists', () => {
    const text = Array.from({ length: 10 }, (_, i) => `r${i},x`).join('\n')
    const capped = parseDelimited(text, ',', 3)
    expect(capped.rows.map((r) => r[0])).toEqual(['r0', 'r1', 'r2'])
    expect(capped.truncatedRows).toBe(true)

    const exact = parseDelimited('a\nb\nc\n\n', ',', 3)
    expect(exact.rows).toHaveLength(3)
    expect(exact.truncatedRows).toBe(false)
  })

  it('caps columns and reports it', () => {
    const t = parseDelimited('a,b,c,d\n1,2\n', ',', 100, 2)
    expect(t.rows).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(t.columnCount).toBe(2)
    expect(t.truncatedColumns).toBe(true)
    expect(parseDelimited('a,b\n', ',', 100, 2).truncatedColumns).toBe(false)
  })

  it('reports the widest row as the column count', () => {
    expect(parseDelimited('a\nb,c,d\ne,f\n').columnCount).toBe(3)
  })
})
