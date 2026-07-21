import { describe, expect, it } from 'vitest'
import { deriveKanbanColumn } from './derive-column'

const base = { archived: false, running: false, awaiting: false, unseen: false }

describe('deriveKanbanColumn', () => {
  it('hides archived chats regardless of live status', () => {
    expect(deriveKanbanColumn({ ...base, archived: true, running: true })).toBeNull()
  })

  it('awaiting input outranks running', () => {
    expect(deriveKanbanColumn({ ...base, awaiting: true, running: true })).toBe('needs-input')
  })

  it('running outranks unseen', () => {
    expect(deriveKanbanColumn({ ...base, running: true, unseen: true })).toBe('in-progress')
  })

  it('unseen-finished chats are ready to review', () => {
    expect(deriveKanbanColumn({ ...base, unseen: true })).toBe('ready')
  })

  it('defaults to idle', () => {
    expect(deriveKanbanColumn(base)).toBe('idle')
  })
})
