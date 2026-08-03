import { describe, expect, it } from 'vitest'
import { describeAgentError } from './agent-error-text'

describe('describeAgentError', () => {
  it('returns the message from an Error-like object', () => {
    expect(describeAgentError({ message: 'model not found' })).toBe('model not found')
  })

  it('returns bare string errors', () => {
    expect(describeAgentError('boom')).toBe('boom')
  })

  it('never returns blank text for empty messages', () => {
    expect(describeAgentError({ message: '' })).toBe('Unknown agent error')
    expect(describeAgentError({ message: '   ' })).toBe('Unknown agent error')
  })

  it('falls back for null, undefined, and empty objects', () => {
    expect(describeAgentError(null)).toBe('Unknown agent error')
    expect(describeAgentError(undefined)).toBe('Unknown agent error')
    expect(describeAgentError({})).toBe('Unknown agent error')
  })

  it('digs into nested cause/error/data fields when message is empty', () => {
    expect(describeAgentError({ message: '', cause: { message: 'no API key configured' } })).toBe(
      'no API key configured'
    )
    expect(describeAgentError({ error: { message: 'gateway rejected model' } })).toBe(
      'gateway rejected model'
    )
    expect(describeAgentError({ data: { message: 'quota exceeded' } })).toBe('quota exceeded')
  })

  it('unwraps JSON-blob messages', () => {
    const blob = JSON.stringify({
      message: 'Failed to connect to MCP server vercel: Error: Unauthorized',
      domain: 'MCP',
      category: 'THIRD_PARTY'
    })
    expect(describeAgentError({ message: blob })).toBe(
      'Failed to connect to MCP server vercel: Error: Unauthorized'
    )
    expect(describeAgentError(blob)).toBe(
      'Failed to connect to MCP server vercel: Error: Unauthorized'
    )
  })

  it('keeps the raw string when a JSON blob has no usable message', () => {
    expect(describeAgentError('{"domain":1}')).toBe('{"domain":1}')
  })

  it('uses name and code when no message exists anywhere', () => {
    expect(
      describeAgentError({ message: '', name: 'AI_APICallError', code: 'model_not_found' })
    ).toBe('AI_APICallError model_not_found')
    expect(describeAgentError({ name: 'NoSuchModelError' })).toBe('NoSuchModelError')
    expect(describeAgentError({ code: 404 })).toBe('404')
  })

  it('ignores a bare generic Error name', () => {
    expect(describeAgentError({ name: 'Error' })).toBe('Unknown agent error')
  })

  it('stringifies primitive errors', () => {
    expect(describeAgentError(42)).toBe('42')
  })

  it('bounds recursion on deeply nested causes', () => {
    let deep: Record<string, unknown> = { message: 'too deep to reach' }
    for (let i = 0; i < 10; i++) deep = { cause: deep }
    expect(describeAgentError(deep)).toBe('Unknown agent error')
  })
})
