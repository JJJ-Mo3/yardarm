import { describe, expect, it } from 'vitest'
import { exportChatMarkdown } from './export-chat'
import type { StoredMessage } from '../../../../shared/ui-message'

describe('exportChatMarkdown', () => {
  it('renders roles, text, tool calls, and info parts', () => {
    const messages: StoredMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'Fix the bug' }],
        createdAt: 1
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'thinking about it' },
          {
            type: 'tool-call',
            toolCallId: 't1',
            toolName: 'read_file',
            args: { path: 'src/app.ts' },
            status: 'success'
          },
          { type: 'text', text: 'Done.' },
          { type: 'info', level: 'error', text: 'something failed' }
        ],
        createdAt: 2
      }
    ]
    const md = exportChatMarkdown(messages, 'My chat')
    expect(md).toContain('# My chat')
    expect(md).toContain('## User')
    expect(md).toContain('Fix the bug')
    expect(md).toContain('## Assistant')
    expect(md).toContain('> _Thinking_')
    expect(md).toContain('> `read_file` — {"path":"src/app.ts"} (success)')
    expect(md).toContain('Done.')
    expect(md).toContain('> Error: something failed')
    expect(md).not.toMatch(/\n{3,}/)
  })

  it('truncates long tool args', () => {
    const messages: StoredMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 't1',
            toolName: 'bash',
            args: { command: 'x'.repeat(400) },
            status: 'running'
          }
        ],
        createdAt: 1
      }
    ]
    const md = exportChatMarkdown(messages, 'chat')
    expect(md).toContain('…')
    expect(md.length).toBeLessThan(400)
  })
})
