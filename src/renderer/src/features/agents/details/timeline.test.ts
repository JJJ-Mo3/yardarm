/** Tests for the session-timeline derivation (details-panel widget). */
import { describe, expect, it } from 'vitest'
import { buildTimeline, type TimelineCheckpoint } from './timeline'
import type { MessagePart, StoredMessage } from '../../../../../shared/ui-message'

let nextId = 0
function msg(
  role: 'user' | 'assistant',
  parts: MessagePart[],
  createdAt: number,
  modelId?: string
): StoredMessage {
  return { id: `m${++nextId}`, role, parts, createdAt, modelId }
}

function tool(
  toolName: string,
  args: unknown,
  status: 'success' | 'error' = 'success'
): MessagePart {
  return { type: 'tool-call', toolCallId: `t${++nextId}`, toolName, args, status }
}

describe('buildTimeline', () => {
  it('turns user text into prompt events with first-line truncation', () => {
    const events = buildTimeline([
      msg('user', [{ type: 'text', text: 'Fix the bug\nwith details below' }], 1)
    ])
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('prompt')
    expect(events[0].label).toBe('Fix the bug …')
    expect(events[0].ts).toBe(1)
  })

  it('classifies marker text parts as marker events', () => {
    const events = buildTimeline([
      msg('user', [{ type: 'text', text: 'Ask: how does rollback work?', marker: true }], 1)
    ])
    expect(events[0].kind).toBe('marker')
    expect(events[0].label).toBe('Ask: how does rollback work?')
  })

  it('skips empty user text parts', () => {
    expect(buildTimeline([msg('user', [{ type: 'text', text: '   ' }], 1)])).toHaveLength(0)
  })

  it('summarizes commands with status and first line', () => {
    const events = buildTimeline([
      msg(
        'assistant',
        [
          tool('execute_command', { command: 'pnpm test\n--run' }),
          tool('execute_command', { command: 'pnpm lint' }, 'error')
        ],
        2
      )
    ])
    expect(events[0]).toMatchObject({ kind: 'command', label: '$ pnpm test …', failed: false })
    expect(events[1]).toMatchObject({ kind: 'command', label: '$ pnpm lint', failed: true })
  })

  it('degrades clamped command args to a generic row', () => {
    const events = buildTimeline([
      msg('assistant', [tool('execute_command', { __truncated: true, preview: 'x' })], 2)
    ])
    expect(events[0].label).toBe('Ran a command')
  })

  it('maps file tools to file events with paths and actions', () => {
    const events = buildTimeline([
      msg(
        'assistant',
        [
          tool('write_file', { path: 'src/a.ts' }),
          tool('delete_file', { path: 'src/b.ts' }),
          tool('mkdir', { path: 'src/dir' })
        ],
        2
      )
    ])
    expect(events[0]).toMatchObject({ kind: 'file', action: 'write', path: 'src/a.ts' })
    expect(events[1]).toMatchObject({ kind: 'file', action: 'delete', path: 'src/b.ts' })
    expect(events[2]).toMatchObject({ kind: 'file', action: 'mkdir', path: 'src/dir' })
  })

  it('collapses consecutive same-file edits into one row with a count', () => {
    const events = buildTimeline([
      msg(
        'assistant',
        [
          tool('string_replace_lsp', { path: 'src/a.ts' }),
          tool('ast_smart_edit', { path: 'src/a.ts' }),
          tool('string_replace_lsp', { path: 'src/b.ts' })
        ],
        2
      )
    ])
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ path: 'src/a.ts', count: 2 })
    expect(events[1]).toMatchObject({ path: 'src/b.ts' })
    expect(events[1].count).toBeUndefined()
  })

  it('degrades file events without a path instead of collapsing them', () => {
    const events = buildTimeline([
      msg('assistant', [tool('write_file', {}), tool('write_file', {})], 2)
    ])
    expect(events).toHaveLength(2)
    expect(events[0].label).toBe('Wrote a file')
    expect(events[0].path).toBeUndefined()
  })

  it('summarizes subagent runs from description or task args', () => {
    const events = buildTimeline([
      msg('assistant', [tool('subagent', { description: 'Explore the auth flow' })], 2)
    ])
    expect(events[0]).toMatchObject({ kind: 'subagent', label: 'Subagent: Explore the auth flow' })
  })

  it('ignores reads, searches, and interactive tools', () => {
    const events = buildTimeline([
      msg(
        'assistant',
        [
          tool('view', { path: 'src/a.ts' }),
          tool('search_content', { pattern: 'x' }),
          tool('submit_plan', { plan: 'p' }),
          tool('ask_user', { question: 'q' })
        ],
        2
      )
    ])
    expect(events).toHaveLength(0)
  })

  it('emits model events only when the model changes', () => {
    const events = buildTimeline([
      msg('assistant', [], 1, 'model-a'),
      msg('assistant', [], 2, 'model-a'),
      msg('assistant', [], 3, 'model-b')
    ])
    expect(events.map((e) => [e.kind, e.label])).toEqual([
      ['model', 'model-a'],
      ['model', 'model-b']
    ])
  })

  it('merges checkpoints chronologically', () => {
    const checkpoints: TimelineCheckpoint[] = [
      { id: 'c1', name: 'before refactor', source: 'manual', createdAt: 2 },
      { id: 'c2', name: null, source: 'auto', createdAt: 9 }
    ]
    const events = buildTimeline(
      [
        msg('user', [{ type: 'text', text: 'go' }], 1),
        msg('assistant', [tool('execute_command', { command: 'ls' })], 5)
      ],
      checkpoints
    )
    expect(events.map((e) => e.kind)).toEqual(['prompt', 'checkpoint', 'command', 'checkpoint'])
    expect(events[1].label).toBe('before refactor')
    expect(events[3].label).toBe('Auto checkpoint')
  })
})
