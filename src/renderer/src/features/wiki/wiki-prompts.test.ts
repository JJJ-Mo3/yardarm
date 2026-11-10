/** Tests for the wiki generation prompt + completed-run detection. */
import { describe, expect, it } from 'vitest'
import { buildWikiPrompt, findCompletedWikiRun, WIKI_MARKER } from './wiki-prompts'
import type { StoredMessage } from '../../../../shared/ui-message'

let nextId = 0
function msg(role: 'user' | 'assistant', text: string, marker = false): StoredMessage {
  return {
    id: `m${++nextId}`,
    role,
    parts: [{ type: 'text', text, ...(marker ? { marker: true } : {}) }],
    createdAt: nextId
  }
}

describe('buildWikiPrompt', () => {
  it('targets the staging folder with index + module pages and citations', () => {
    const prompt = buildWikiPrompt()
    expect(prompt).toContain('.yardarm-wiki/')
    expect(prompt).toContain('index.md')
    expect(prompt).toContain('mermaid')
    expect(prompt).toContain('meta.json')
    expect(prompt).toContain('repo-relative paths')
  })
})

describe('findCompletedWikiRun', () => {
  it('returns null for empty transcripts', () => {
    expect(findCompletedWikiRun([])).toBeNull()
  })

  it('returns null while nothing follows the marker yet', () => {
    expect(findCompletedWikiRun([msg('user', WIKI_MARKER, true)])).toBeNull()
  })

  it('finds the run once the agent produced something after the marker', () => {
    const marker = msg('user', WIKI_MARKER, true)
    const messages = [marker, msg('assistant', 'Wrote 6 pages.')]
    expect(findCompletedWikiRun(messages)).toEqual({ markerId: marker.id })
  })

  it('ignores non-wiki markers and plain user messages', () => {
    expect(
      findCompletedWikiRun([msg('user', 'Review: local changes', true), msg('assistant', 'done')])
    ).toBeNull()
    expect(
      findCompletedWikiRun([msg('user', 'generate a wiki'), msg('assistant', 'done')])
    ).toBeNull()
  })

  it('only considers the last user message', () => {
    const messages = [
      msg('user', WIKI_MARKER, true),
      msg('assistant', 'done'),
      msg('user', 'thanks'),
      msg('assistant', 'np')
    ]
    expect(findCompletedWikiRun(messages)).toBeNull()
  })
})
