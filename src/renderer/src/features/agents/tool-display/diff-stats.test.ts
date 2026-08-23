import { describe, expect, it } from 'vitest'
import { countLines, diffStatsFor } from './diff-stats'

describe('countLines', () => {
  it('returns 0 for an empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('counts single and multi-line strings', () => {
    expect(countLines('a')).toBe(1)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('a\nb\nc\n')).toBe(4)
  })
})

describe('diffStatsFor', () => {
  it('computes stats for string_replace_lsp', () => {
    expect(
      diffStatsFor('string_replace_lsp', { old_string: 'a\nb', new_string: 'x\ny\nz' })
    ).toEqual({ added: 3, removed: 2 })
  })

  it('computes stats for write_file', () => {
    expect(diffStatsFor('write_file', { content: 'a\nb\nc' })).toEqual({ added: 3, removed: 0 })
  })

  it('computes stats for ast_smart_edit when pattern and replacement are strings', () => {
    expect(diffStatsFor('ast_smart_edit', { pattern: 'a', replacement: 'x\ny' })).toEqual({
      added: 2,
      removed: 1
    })
  })

  it('returns null for ast_smart_edit rename-style transforms', () => {
    expect(diffStatsFor('ast_smart_edit', { targetName: 'foo', newName: 'bar' })).toBeNull()
  })

  it('returns null for null args (partial JSON while streaming)', () => {
    expect(diffStatsFor('string_replace_lsp', null)).toBeNull()
  })

  it('returns null for truncated-args stubs', () => {
    expect(diffStatsFor('string_replace_lsp', { __truncated: true, preview: 'x' })).toBeNull()
    expect(diffStatsFor('write_file', { __truncated: true, preview: 'x' })).toBeNull()
  })

  it('returns null for tools without edit semantics', () => {
    expect(diffStatsFor('view', { path: 'a.ts' })).toBeNull()
    expect(diffStatsFor('execute_command', { command: 'ls' })).toBeNull()
  })
})
