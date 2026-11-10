import { describe, expect, it } from 'vitest'
import { MAX_FOLLOW_UPS, parseFollowUps, stripFollowUpLines } from './follow-ups'

describe('parseFollowUps', () => {
  it('parses a single plain marker', () => {
    expect(parseFollowUps('Done.\nFollow-up: Add tests for the parser module')).toEqual([
      'Add tests for the parser module'
    ])
  })

  it('parses multiple markers in order', () => {
    const text = [
      'All set.',
      'Follow-up: Add tests for the scheduler',
      'Follow-up: Document the new setting',
      'Follow-up: Wire the chips into MessageList'
    ].join('\n')
    expect(parseFollowUps(text)).toEqual([
      'Add tests for the scheduler',
      'Document the new setting',
      'Wire the chips into MessageList'
    ])
  })

  it('caps at MAX_FOLLOW_UPS and dedupes', () => {
    const lines = ['Follow-up: Duplicate suggestion here']
    for (let i = 0; i < 5; i++) lines.push(`Follow-up: Unique suggestion number ${i}`)
    lines.push('Follow-up: Duplicate suggestion here')
    const parsed = parseFollowUps(lines.join('\n'))
    expect(parsed).toHaveLength(MAX_FOLLOW_UPS)
    expect(new Set(parsed).size).toBe(MAX_FOLLOW_UPS)
  })

  it('tolerates bold, casing, separators, list and blockquote prefixes', () => {
    expect(parseFollowUps('**Follow-up:** Run the migration on staging')).toEqual([
      'Run the migration on staging'
    ])
    expect(parseFollowUps('> follow-up — Review the generated config')).toEqual([
      'Review the generated config'
    ])
    expect(parseFollowUps('- FOLLOW UP: Ship the release notes')).toEqual([
      'Ship the release notes'
    ])
    expect(parseFollowUps('Follow-ups: Tighten the zod schema')).toEqual(['Tighten the zod schema'])
  })

  it('ignores markers inside code fences', () => {
    const text = '```\nFollow-up: Inside a fence, ignored\n```\nFollow-up: Outside the fence'
    expect(parseFollowUps(text)).toEqual(['Outside the fence'])
  })

  it('applies the length floor and rejects prose mentions', () => {
    expect(parseFollowUps('Follow-up: none')).toEqual([])
    expect(parseFollowUps('A good follow-up would be to add tests later.')).toEqual([])
    expect(parseFollowUps('No markers here at all')).toEqual([])
  })
})

describe('stripFollowUpLines', () => {
  it('removes marker lines and collapses blank runs', () => {
    const text = 'Done with the task.\n\nFollow-up: Add tests\n\nFollow-up: Update the docs page'
    expect(stripFollowUpLines(text)).toBe('Done with the task.')
  })

  it('returns text unchanged when no marker parses', () => {
    const text = 'Nothing to see here.\nFollow-up: none'
    expect(stripFollowUpLines(text)).toBe(text)
  })

  it('keeps fenced content intact', () => {
    const text = 'Intro\n```\nFollow-up: keep me, I am code\n```\nFollow-up: Strip this one away'
    expect(stripFollowUpLines(text)).toBe('Intro\n```\nFollow-up: keep me, I am code\n```')
  })
})
