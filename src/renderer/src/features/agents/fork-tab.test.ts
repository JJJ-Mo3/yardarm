import { describe, expect, it } from 'vitest'
import { subchatTabLabel, subchatTabTip } from './fork-tab'

const plain = { id: 'a', forkedFromSubchatId: null }
const fork = { id: 'b', forkedFromSubchatId: 'a' }
const orphan = { id: 'c', forkedFromSubchatId: 'gone' }

describe('subchatTabLabel', () => {
  it('labels non-forked tabs plainly', () => {
    expect(subchatTabLabel([plain, fork], 0)).toBe('Tab 1')
  })

  it('names the parent tab of a fork', () => {
    expect(subchatTabLabel([plain, fork], 1)).toBe('Tab 2 (fork of Tab 1)')
  })

  it('degrades gracefully when the parent tab is gone', () => {
    expect(subchatTabLabel([plain, orphan], 1)).toBe('Tab 2 (fork)')
  })
})

describe('subchatTabTip', () => {
  it('uses the generic tip for non-forks', () => {
    expect(subchatTabTip([plain, fork], 0)).toContain('own transcript')
  })

  it('notes the fork origin', () => {
    expect(subchatTabTip([plain, fork], 1)).toContain('forked from Tab 1')
  })

  it('notes a removed parent', () => {
    expect(subchatTabTip([plain, orphan], 1)).toContain('removed tab')
  })
})
