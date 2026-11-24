import { describe, expect, it } from 'vitest'
import {
  compareChatTitle,
  modelLabel,
  normalizeCompareModels,
  planCompareLayout,
  summarizePrompt
} from './compare'

describe('summarizePrompt', () => {
  it('uses the first non-empty line, whitespace-collapsed', () => {
    expect(summarizePrompt('\n\n  Fix   the login\tredirect \nmore detail')).toBe(
      'Fix the login redirect'
    )
    expect(summarizePrompt('   ')).toBe('')
  })

  it('truncates long prompts at a word boundary with an ellipsis', () => {
    const s = summarizePrompt('Refactor the authentication middleware to support refresh tokens')
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s.endsWith('…')).toBe(true)
    expect(s).toBe('Refactor the authentication middleware…')
    expect(summarizePrompt('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('modelLabel / compareChatTitle', () => {
  it('drops the provider prefix', () => {
    expect(modelLabel('provider/model-a')).toBe('model-a')
    expect(modelLabel('gateway/provider/model-b')).toBe('model-b')
    expect(modelLabel('bare-model')).toBe('bare-model')
    expect(modelLabel('trailing/')).toBe('trailing/')
  })

  it('builds "<summary> — <model>" titles', () => {
    expect(compareChatTitle('Add dark mode', 'provider/model-a')).toBe('Add dark mode — model-a')
    expect(compareChatTitle('', 'provider/model-a')).toBe('Comparison — model-a')
  })
})

describe('normalizeCompareModels', () => {
  it('trims, dedupes and keeps order', () => {
    expect(normalizeCompareModels([' a/x ', 'b/y', 'a/x', ''])).toEqual({
      ok: true,
      modelIds: ['a/x', 'b/y']
    })
  })

  it('rejects fewer than two or more than four models', () => {
    expect(normalizeCompareModels(['a/x', 'a/x']).ok).toBe(false)
    expect(normalizeCompareModels([]).ok).toBe(false)
    expect(normalizeCompareModels(['1', '2', '3', '4']).ok).toBe(true)
    expect(normalizeCompareModels(['1', '2', '3', '4', '5']).ok).toBe(false)
  })
})

describe('planCompareLayout', () => {
  const chats = ['a', 'b', 'c', 'd'].map((id) => ({ chatId: id, subchatId: `s-${id}` }))

  it('puts the first chat in the primary pane and the rest in split panes', () => {
    const plan = planCompareLayout(chats, 5)
    expect(plan.primary?.chatId).toBe('a')
    expect(plan.panes.map((p) => p.chatId)).toEqual(['b', 'c', 'd'])
    expect(plan.overflow).toEqual([])
  })

  it('respects the split-pane cap', () => {
    const plan = planCompareLayout(chats, 2)
    expect(plan.panes.map((p) => p.chatId)).toEqual(['b', 'c'])
    expect(plan.overflow.map((p) => p.chatId)).toEqual(['d'])
    expect(planCompareLayout(chats, 0).panes).toEqual([])
    expect(planCompareLayout([], 5)).toEqual({ primary: null, panes: [], overflow: [] })
  })
})
