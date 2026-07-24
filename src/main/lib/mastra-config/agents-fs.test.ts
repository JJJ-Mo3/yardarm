/** Tests for the agent .md parse/serialize helpers and definition merging. */
import { describe, expect, it } from 'vitest'
import { mergeSubagentDefinitions, parseAgentMarkdown, serializeAgentMarkdown } from './agents-fs'
import type { SubagentDefinition } from '../../../shared/ipc-types'

function def(id: string, description = 'd'): SubagentDefinition {
  return { id, name: id, description, instructions: 'i' }
}

describe('parseAgentMarkdown', () => {
  it('parses all frontmatter fields and the body', () => {
    const raw = [
      '---',
      'name: Docs Writer',
      'description: Writes documentation',
      'model: gpt-5',
      'maxSteps: 25',
      'forked: true',
      '---',
      '',
      'Write great docs.'
    ].join('\n')
    expect(parseAgentMarkdown('docs', raw)).toEqual({
      name: 'Docs Writer',
      description: 'Writes documentation',
      instructions: 'Write great docs.',
      model: 'gpt-5',
      maxSteps: 25,
      forked: true
    })
  })

  it('defaults name to the id and omits optional fields', () => {
    const parsed = parseAgentMarkdown('helper', '---\ndescription: Helps\n---\nBody')
    expect(parsed).toEqual({
      name: 'helper',
      description: 'Helps',
      instructions: 'Body',
      model: undefined,
      maxSteps: undefined,
      forked: undefined
    })
  })

  it('returns null when description is missing', () => {
    expect(parseAgentMarkdown('x', '---\nname: X\n---\nBody')).toBeNull()
    expect(parseAgentMarkdown('x', 'no frontmatter at all')).toBeNull()
  })

  it('ignores invalid maxSteps and non-true forked', () => {
    const raw = '---\ndescription: d\nmaxSteps: -3\nforked: false\n---\nB'
    expect(parseAgentMarkdown('x', raw)).toMatchObject({ maxSteps: undefined, forked: undefined })
    const raw2 = '---\ndescription: d\nmaxSteps: abc\n---\nB'
    expect(parseAgentMarkdown('x', raw2)).toMatchObject({ maxSteps: undefined })
  })

  it('round-trips through serializeAgentMarkdown', () => {
    const data = {
      name: 'Reviewer',
      description: 'Reviews code',
      instructions: 'Be thorough.\n\nBe kind.',
      model: 'claude-opus-4-6',
      maxSteps: 12,
      forked: true
    }
    expect(parseAgentMarkdown('reviewer', serializeAgentMarkdown(data))).toEqual(data)
  })

  it('serializes minimal data without optional keys', () => {
    const out = serializeAgentMarkdown({ name: 'a', description: 'd', instructions: 'i' })
    expect(out).not.toContain('model:')
    expect(out).not.toContain('maxSteps:')
    expect(out).not.toContain('forked:')
  })
})

describe('mergeSubagentDefinitions', () => {
  it('lets project definitions win over global ones', () => {
    const { defs, skipped } = mergeSubagentDefinitions(
      [def('a', 'global'), def('b')],
      [def('a', 'project')]
    )
    expect(skipped).toEqual([])
    expect(defs.find((d) => d.id === 'a')?.description).toBe('project')
    expect(defs.map((d) => d.id).sort()).toEqual(['a', 'b'])
  })

  it('skips reserved and invalid ids', () => {
    const { defs, skipped } = mergeSubagentDefinitions(
      [def('explore'), def('bad id')],
      [def('plan'), def('ok')]
    )
    expect(defs.map((d) => d.id)).toEqual(['ok'])
    expect(skipped.sort()).toEqual(['bad id', 'explore', 'plan'])
  })
})
