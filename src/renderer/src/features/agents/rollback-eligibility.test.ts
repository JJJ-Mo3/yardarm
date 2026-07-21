import { describe, expect, it } from 'vitest'
import { computeRollbackEligible } from './rollback-eligibility'
import type { MessagePart, StoredMessage, ToolCallPart } from '../../../../shared/ui-message'

let nextId = 0
function msg(role: 'user' | 'assistant', parts: MessagePart[] = []): StoredMessage {
  return { id: `m${nextId++}`, role, parts, createdAt: 0 }
}

function tool(toolName: string, status: ToolCallPart['status']): ToolCallPart {
  return { type: 'tool-call', toolCallId: `t${nextId++}`, toolName, args: {}, status }
}

describe('computeRollbackEligible', () => {
  it('marks nothing when no tools ran', () => {
    const u = msg('user', [{ type: 'text', text: 'hi' }])
    const a = msg('assistant', [{ type: 'text', text: 'hello' }])
    expect(computeRollbackEligible([u, a]).size).toBe(0)
  })

  it('marks a user message followed by a successful change-capable tool', () => {
    const u = msg('user')
    const a = msg('assistant', [tool('edit', 'success')])
    expect(computeRollbackEligible([u, a])).toEqual(new Set([u.id]))
  })

  it('counts an in-flight change-capable tool (change may be happening now)', () => {
    const u = msg('user')
    const a = msg('assistant', [tool('execute_command', 'running')])
    expect(computeRollbackEligible([u, a])).toEqual(new Set([u.id]))
  })

  it('ignores errored, declined, and never-run change-capable tools', () => {
    const u = msg('user')
    const a = msg('assistant', [
      tool('edit', 'error'),
      tool('write', 'awaiting-approval'),
      tool('execute_command', 'input-streaming'),
      tool('delete', 'suspended')
    ])
    expect(computeRollbackEligible([u, a]).size).toBe(0)
  })

  it('ignores successful readonly tools', () => {
    const u = msg('user')
    const a = msg('assistant', [tool('view', 'success'), tool('search_content', 'success')])
    expect(computeRollbackEligible([u, a]).size).toBe(0)
  })

  it('marks all earlier user messages once a later change lands', () => {
    const u1 = msg('user')
    const a1 = msg('assistant', [tool('view', 'success')])
    const u2 = msg('user')
    const a2 = msg('assistant', [tool('write', 'success')])
    const u3 = msg('user')
    const a3 = msg('assistant', [{ type: 'text', text: 'done' }])
    expect(computeRollbackEligible([u1, a1, u2, a2, u3, a3])).toEqual(new Set([u1.id, u2.id]))
  })
})
