import { describe, expect, it } from 'vitest'
import type { StoredMessage, ToolCallPart } from '../../../shared/ui-message'
import { clampMessageForStorage } from './message-clamp'

function message(parts: StoredMessage['parts']): StoredMessage {
  return { id: 'm1', role: 'assistant', parts, createdAt: 0 }
}

function toolCall(overrides: Partial<ToolCallPart>): ToolCallPart {
  return {
    type: 'tool-call',
    toolCallId: 't1',
    toolName: 'Shell',
    args: {},
    status: 'success',
    ...overrides
  }
}

describe('clampMessageForStorage', () => {
  it('returns the same reference when nothing exceeds limits', () => {
    const msg = message([
      { type: 'text', text: 'hello' },
      toolCall({ outputText: 'ok', result: { fine: true } })
    ])
    expect(clampMessageForStorage(msg)).toBe(msg)
  })

  it('elides oversized tool outputText with a head+tail truncation marker', () => {
    const big = 'a'.repeat(200 * 1024)
    const msg = message([toolCall({ outputText: big })])
    const clamped = clampMessageForStorage(msg)
    expect(clamped).not.toBe(msg)
    const part = clamped.parts[0] as ToolCallPart
    expect(part.outputText!.length).toBeLessThan(big.length)
    expect(part.outputText).toMatch(/… \[truncated \d+ KB\] …/)
    expect(part.outputText!.startsWith('aaa')).toBe(true)
    expect(part.outputText!.endsWith('aaa')).toBe(true)
  })

  it('replaces oversized args and result with a truncation marker object', () => {
    const msg = message([
      toolCall({ args: { blob: 'x'.repeat(64 * 1024) }, result: { blob: 'y'.repeat(128 * 1024) } })
    ])
    const part = clampMessageForStorage(msg).parts[0] as ToolCallPart
    expect(part.args).toMatchObject({ __truncated: true })
    expect((part.args as { preview: string }).preview.length).toBeLessThanOrEqual(9 * 1024)
    expect(part.result).toMatchObject({ __truncated: true })
  })

  it('clamps oversized text parts and leaves small ones untouched', () => {
    const big = 'z'.repeat(300 * 1024)
    const clamped = clampMessageForStorage(message([{ type: 'text', text: big }]))
    const part = clamped.parts[0] as { type: 'text'; text: string }
    expect(part.text.length).toBeLessThan(big.length)
    expect(part.text).toContain('[truncated')
  })
})
