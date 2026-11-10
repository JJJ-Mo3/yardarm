import { describe, expect, it } from 'vitest'
import { buildDraftWorkflowPrompt, parseInputFields } from './input-schema'

const def = (inputSchema: unknown): string => JSON.stringify({ id: 'wf-1', inputSchema })

describe('parseInputFields', () => {
  it('parses a flat object schema into fields', () => {
    const json = def({
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Directory to scan' },
        limit: { type: 'number' },
        dryRun: { type: 'boolean' }
      },
      required: ['target']
    })
    expect(parseInputFields(json)).toEqual([
      { key: 'target', type: 'string', required: true, description: 'Directory to scan' },
      { key: 'limit', type: 'number', required: false },
      { key: 'dryRun', type: 'boolean', required: false }
    ])
  })

  it('returns an empty list for an object schema with no properties', () => {
    expect(parseInputFields(def({ type: 'object', properties: {} }))).toEqual([])
  })

  it('returns null for unparseable JSON', () => {
    expect(parseInputFields('not json')).toBeNull()
  })

  it('returns null when inputSchema is missing or not an object schema', () => {
    expect(parseInputFields(JSON.stringify({ id: 'wf-1' }))).toBeNull()
    expect(parseInputFields(def('string'))).toBeNull()
    expect(parseInputFields(def({ type: 'string' }))).toBeNull()
  })

  it('returns null when any property is non-simple (raw-JSON fallback)', () => {
    const nested = def({
      type: 'object',
      properties: { opts: { type: 'object', properties: {} } }
    })
    expect(parseInputFields(nested)).toBeNull()
    const arr = def({ type: 'object', properties: { items: { type: 'array' } } })
    expect(parseInputFields(arr)).toBeNull()
  })

  it('ignores non-string entries in required', () => {
    const json = def({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: [1, 'a']
    })
    expect(parseInputFields(json)).toEqual([{ key: 'a', type: 'string', required: true }])
  })
})

describe('buildDraftWorkflowPrompt', () => {
  it('embeds the description and names the workflow tools', () => {
    const prompt = buildDraftWorkflowPrompt('  runs the tests and summarizes failures ')
    expect(prompt).toContain('create_workflow / save_workflow')
    expect(prompt).toContain('runs the tests and summarizes failures')
    expect(prompt).toContain('Report the saved workflow id')
  })
})
