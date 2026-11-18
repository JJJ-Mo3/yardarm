/** Tests for integration formatting helpers. */
import { describe, expect, it } from 'vitest'
import {
  compactArgs,
  extractFinalText,
  formatApprovalMessage,
  formatForPlatform,
  formatQuestionMessage
} from './format'
import type { StoredMessage } from '../../../shared/ui-message'

function msg(role: 'user' | 'assistant', parts: StoredMessage['parts']): StoredMessage {
  return { id: Math.random().toString(36).slice(2), role, parts, createdAt: Date.now() }
}

describe('extractFinalText', () => {
  it('returns the text of the last assistant message, skipping markers', () => {
    const messages = [
      msg('user', [{ type: 'text', text: 'do the thing' }]),
      msg('assistant', [{ type: 'text', text: 'older answer' }]),
      msg('user', [{ type: 'text', text: 'and another' }]),
      msg('assistant', [
        { type: 'text', text: 'Remote prompt via Slack', marker: true },
        { type: 'reasoning', text: 'thinking...' },
        { type: 'text', text: 'Done. I fixed the bug.' }
      ])
    ]
    expect(extractFinalText(messages)).toBe('Done. I fixed the bug.')
  })

  it('falls back to earlier assistant messages when the last has no text', () => {
    const messages = [
      msg('assistant', [{ type: 'text', text: 'real answer' }]),
      msg('assistant', [{ type: 'text', text: 'note', marker: true }])
    ]
    expect(extractFinalText(messages)).toBe('real answer')
  })

  it('returns empty when nothing qualifies', () => {
    expect(extractFinalText([])).toBe('')
    expect(extractFinalText([msg('user', [{ type: 'text', text: 'hi' }])])).toBe('')
  })
})

describe('formatForPlatform', () => {
  it('converts bold, headings, links, and strikethrough to Slack mrkdwn', () => {
    const input = '# Title\nThis is **bold** and ~~gone~~, see [docs](https://example.com/x).'
    expect(formatForPlatform(input, 'slack')).toBe(
      '*Title*\nThis is *bold* and ~gone~, see <https://example.com/x|docs>.'
    )
  })

  it('leaves code fences and inline code untouched for Slack', () => {
    const input = 'Use `**not bold**` and:\n```\n# not a heading\n**raw**\n```\ndone **bold**'
    const out = formatForPlatform(input, 'slack')
    expect(out).toContain('`**not bold**`')
    expect(out).toContain('# not a heading\n**raw**')
    expect(out).toContain('done *bold*')
  })

  it('passes Discord text through unchanged', () => {
    const input = '# Title\n**bold** [docs](https://example.com)'
    expect(formatForPlatform(input, 'discord')).toBe(input)
  })
})

describe('approval and question formatting', () => {
  it('truncates long args', () => {
    const long = { command: 'x'.repeat(2000) }
    const compact = compactArgs(long)
    expect(compact.length).toBeLessThanOrEqual(601)
    expect(compact.endsWith('…')).toBe(true)
  })

  it('formats an approval request with tool name, args, and instructions', () => {
    const out = formatApprovalMessage('run_command', { command: 'rm -rf node_modules' })
    expect(out).toContain('run_command')
    expect(out).toContain('rm -rf node_modules')
    expect(out).toContain('"approve"')
    expect(out).toContain('deny')
  })

  it('formats a question with options', () => {
    const out = formatQuestionMessage({
      question: 'Which approach?',
      options: [{ label: 'A', description: 'fast' }, { label: 'B' }]
    })
    expect(out).toContain('Which approach?')
    expect(out).toContain('• A — fast')
    expect(out).toContain('• B')
    expect(out).toContain('Reply with your answer.')
  })

  it('handles a missing payload gracefully', () => {
    const out = formatQuestionMessage(undefined)
    expect(out).toContain('(no question text)')
  })
})
