import { describe, expect, it } from 'vitest'
import { PR_DRAFT_MARKER, buildPrDraftPrompt, findCompletedPrDraft, parsePrDraft } from './pr-draft'
import type { StoredMessage } from './ui-message'

describe('buildPrDraftPrompt', () => {
  it('uses the given base branch in the git commands', () => {
    const prompt = buildPrDraftPrompt('main')
    expect(prompt).toContain('git log main..HEAD')
    expect(prompt).toContain('git diff main...HEAD')
    expect(prompt).not.toContain('Determine the base branch')
  })

  it('asks the agent to resolve the base branch when none is given', () => {
    const prompt = buildPrDraftPrompt()
    expect(prompt).toContain('Determine the base branch')
    expect(prompt).toContain('git log <base>..HEAD')
  })

  it('is read-only and specifies the pr-draft fence contract', () => {
    const prompt = buildPrDraftPrompt('main')
    expect(prompt).toContain('do not commit, push, or modify any files')
    expect(prompt).toContain('```pr-draft')
    expect(prompt).toContain('"title"')
    expect(prompt).toContain('"body"')
  })
})

describe('parsePrDraft', () => {
  const fence = (json: string): string => '```pr-draft\n' + json + '\n```'

  it('parses a valid fenced JSON draft', () => {
    const text = 'Here you go:\n' + fence('{ "title": "Add foo", "body": "## Summary\\nStuff." }')
    expect(parsePrDraft(text)).toEqual({ title: 'Add foo', body: '## Summary\nStuff.' })
  })

  it('uses the last fence when several are present', () => {
    const text =
      fence('{ "title": "Template", "body": "x" }') +
      '\nActually:\n' +
      fence('{ "title": "Real title", "body": "Real body" }')
    expect(parsePrDraft(text)).toEqual({ title: 'Real title', body: 'Real body' })
  })

  it('returns null without a pr-draft fence (plain fences do not count)', () => {
    expect(parsePrDraft('no fences here')).toBeNull()
    expect(parsePrDraft('```json\n{ "title": "x" }\n```')).toBeNull()
  })

  it('returns null for malformed JSON or a missing title', () => {
    expect(parsePrDraft(fence('{ not json'))).toBeNull()
    expect(parsePrDraft(fence('{ "body": "no title" }'))).toBeNull()
    expect(parsePrDraft(fence('{ "title": "   " }'))).toBeNull()
    expect(parsePrDraft(fence('"just a string"'))).toBeNull()
  })

  it('clamps multi-line titles to the first line and defaults body to empty', () => {
    const draft = parsePrDraft(fence('{ "title": "First line\\nSecond line" }'))
    expect(draft).toEqual({ title: 'First line', body: '' })
  })
})

describe('findCompletedPrDraft', () => {
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
  const reply = '```pr-draft\n{ "title": "Add foo", "body": "## Summary\\nStuff." }\n```'

  it('returns null for an empty transcript', () => {
    expect(findCompletedPrDraft([])).toBeNull()
  })

  it('returns null while nothing follows the marker', () => {
    expect(findCompletedPrDraft([msg('user', PR_DRAFT_MARKER, { marker: true })])).toBeNull()
  })

  it('returns null when the last user message is not the PR-draft marker', () => {
    const messages = [
      msg('user', 'Review: local changes', { marker: true }),
      msg('assistant', reply)
    ]
    expect(findCompletedPrDraft(messages)).toBeNull()
    expect(findCompletedPrDraft([msg('user', PR_DRAFT_MARKER), msg('assistant', reply)])).toBeNull()
  })

  it('parses the draft from the assistant reply after the marker', () => {
    const messages = [
      msg('user', PR_DRAFT_MARKER, { marker: true, id: 'm1' }),
      msg('assistant', reply)
    ]
    expect(findCompletedPrDraft(messages)).toEqual({
      markerId: 'm1',
      draft: { title: 'Add foo', body: '## Summary\nStuff.' }
    })
  })

  it('reports a null draft when the reply has no parsable block', () => {
    const messages = [
      msg('user', PR_DRAFT_MARKER, { marker: true, id: 'm1' }),
      msg('assistant', 'I looked at the diff but forgot the fence.')
    ]
    expect(findCompletedPrDraft(messages)).toEqual({ markerId: 'm1', draft: null })
  })

  it('ignores drafts that precede a newer user message', () => {
    const messages = [
      msg('user', PR_DRAFT_MARKER, { marker: true }),
      msg('assistant', reply),
      msg('user', 'unrelated question')
    ]
    expect(findCompletedPrDraft(messages)).toBeNull()
  })
})
