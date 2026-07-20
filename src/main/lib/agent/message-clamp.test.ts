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

  it('clamps oversized info parts', () => {
    const big = 'i'.repeat(64 * 1024)
    const clamped = clampMessageForStorage(message([{ type: 'info', level: 'info', text: big }]))
    const part = clamped.parts[0] as { type: 'info'; text: string }
    expect(part.text.length).toBeLessThan(big.length)
    expect(part.text).toContain('[truncated')
  })

  describe('total parts budget', () => {
    const partsSize = (msg: StoredMessage): number => JSON.stringify(msg.parts).length

    it('minimizes oldest parts to fit the budget while keeping recent ones intact', () => {
      const parts = Array.from({ length: 30 }, (_, i) =>
        toolCall({ toolCallId: `t${i}`, result: { blob: 'r'.repeat(60 * 1024) } })
      )
      const msg = message(parts)
      const clamped = clampMessageForStorage(msg)
      expect(clamped).not.toBe(msg)
      expect(partsSize(clamped)).toBeLessThanOrEqual(1.5 * 1024 * 1024)
      // Last 20 parts keep their (per-part-legal) 60 KB results.
      const recent = clamped.parts.slice(-20) as ToolCallPart[]
      for (const p of recent) {
        expect((p.result as { blob: string }).blob.length).toBe(60 * 1024)
      }
      // Oldest parts were minimized to truncation stubs.
      const oldest = clamped.parts[0] as ToolCallPart
      expect(oldest.result).toMatchObject({ __truncated: true })
    })

    it('minimizes the recent tail too when it alone exceeds the budget', () => {
      const parts = Array.from({ length: 20 }, (_, i) =>
        toolCall({ toolCallId: `t${i}`, outputText: 'o'.repeat(90 * 1024) })
      )
      const clamped = clampMessageForStorage(message(parts))
      expect(partsSize(clamped)).toBeLessThanOrEqual(1.5 * 1024 * 1024)
      // The final part is spared (may still be streaming).
      const last = clamped.parts[clamped.parts.length - 1] as ToolCallPart
      expect(last.outputText!.length).toBe(90 * 1024)
    })

    it('is idempotent: re-clamping a clamped message changes nothing', () => {
      const parts = [
        { type: 'text' as const, text: 'x'.repeat(300 * 1024) },
        ...Array.from({ length: 30 }, (_, i) =>
          toolCall({
            toolCallId: `t${i}`,
            args: { a: 'a'.repeat(60 * 1024) },
            result: { blob: 'r'.repeat(120 * 1024) },
            outputText: 'o'.repeat(150 * 1024)
          })
        )
      ]
      const once = clampMessageForStorage(message(parts))
      const twice = clampMessageForStorage(once)
      expect(twice).toBe(once)
    })

    it('leaves messages under the budget untouched', () => {
      const msg = message(
        Array.from({ length: 10 }, (_, i) =>
          toolCall({ toolCallId: `t${i}`, result: { blob: 'r'.repeat(8 * 1024) } })
        )
      )
      expect(clampMessageForStorage(msg)).toBe(msg)
    })
  })
})
