import { describe, expect, it } from 'vitest'
import { AUTO_APPROVE_TOOLS, shouldAutoApprove } from './task-auto-approve'

describe('shouldAutoApprove', () => {
  it('auto-approves every task tool when no explicit policy exists', () => {
    for (const tool of AUTO_APPROVE_TOOLS) {
      expect(shouldAutoApprove(tool, undefined)).toBe(true)
    }
  })

  it('covers the four task tools', () => {
    expect([...AUTO_APPROVE_TOOLS].sort()).toEqual([
      'task_check',
      'task_complete',
      'task_update',
      'task_write'
    ])
  })

  it('respects an explicit per-tool policy, including ask', () => {
    expect(shouldAutoApprove('task_write', 'ask')).toBe(false)
    expect(shouldAutoApprove('task_update', 'deny')).toBe(false)
    expect(shouldAutoApprove('task_complete', 'allow')).toBe(false)
  })

  it('never auto-approves non-task tools', () => {
    expect(shouldAutoApprove('write_file', undefined)).toBe(false)
    expect(shouldAutoApprove('execute_command', undefined)).toBe(false)
    expect(shouldAutoApprove('ask_user', undefined)).toBe(false)
    expect(shouldAutoApprove('', undefined)).toBe(false)
  })
})
