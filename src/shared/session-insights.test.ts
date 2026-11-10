import { describe, expect, it } from 'vitest'
import {
  INSIGHTS_MARKER,
  buildInsightsPrompt,
  findCompletedInsights,
  parseInsights
} from './session-insights'
import type { StoredMessage } from './ui-message'

describe('buildInsightsPrompt', () => {
  it('is read-only and specifies the session-insights fence contract', () => {
    const prompt = buildInsightsPrompt()
    expect(prompt).toContain('do not run tools')
    expect(prompt).toContain('```session-insights')
    expect(prompt).toContain('## Outcome')
    expect(prompt).toContain('## What changed')
    expect(prompt).toContain('## Risks & follow-ups')
  })
})

describe('parseInsights', () => {
  const fence = (body: string): string => '```session-insights\n' + body + '\n```'

  it('parses the markdown body of a valid fence', () => {
    const text = 'Here you go:\n' + fence('## Outcome\nDone.')
    expect(parseInsights(text)).toBe('## Outcome\nDone.')
  })

  it('uses the last fence when several are present', () => {
    const text = fence('template') + '\nActually:\n' + fence('## Outcome\nReal.')
    expect(parseInsights(text)).toBe('## Outcome\nReal.')
  })

  it('returns null without a session-insights fence (plain fences do not count)', () => {
    expect(parseInsights('no fences here')).toBeNull()
    expect(parseInsights('```markdown\n## Outcome\n```')).toBeNull()
  })

  it('returns null for an empty fence', () => {
    expect(parseInsights(fence('   \n  '))).toBeNull()
  })
})

describe('findCompletedInsights', () => {
  const msg = (
    role: 'user' | 'assistant',
    text: string,
    opts?: { marker?: boolean; id?: string }
  ): StoredMessage => ({
    id: opts?.id ?? `${role}-${text.slice(0, 20)}`,
    role,
    parts: [{ type: 'text', text, ...(opts?.marker ? { marker: true } : {}) }],
    createdAt: 0
  })
  const reply = '```session-insights\n## Outcome\nShipped the feature.\n```'

  it('returns null for an empty transcript', () => {
    expect(findCompletedInsights([])).toBeNull()
  })

  it('returns null while nothing follows the marker', () => {
    expect(findCompletedInsights([msg('user', INSIGHTS_MARKER, { marker: true })])).toBeNull()
  })

  it('returns null when the last user message is not the insights marker', () => {
    const messages = [msg('user', 'PR draft', { marker: true }), msg('assistant', reply)]
    expect(findCompletedInsights(messages)).toBeNull()
    expect(
      findCompletedInsights([msg('user', INSIGHTS_MARKER), msg('assistant', reply)])
    ).toBeNull()
  })

  it('parses the insights from the assistant reply after the marker', () => {
    const messages = [
      msg('user', INSIGHTS_MARKER, { marker: true, id: 'm1' }),
      msg('assistant', reply)
    ]
    expect(findCompletedInsights(messages)).toEqual({
      markerId: 'm1',
      insights: '## Outcome\nShipped the feature.'
    })
  })

  it('reports null insights when the reply has no parsable block', () => {
    const messages = [
      msg('user', INSIGHTS_MARKER, { marker: true, id: 'm1' }),
      msg('assistant', 'I summarized but forgot the fence.')
    ]
    expect(findCompletedInsights(messages)).toEqual({ markerId: 'm1', insights: null })
  })

  it('ignores runs that precede a newer user message', () => {
    const messages = [
      msg('user', INSIGHTS_MARKER, { marker: true }),
      msg('assistant', reply),
      msg('user', 'unrelated question')
    ]
    expect(findCompletedInsights(messages)).toBeNull()
  })
})
