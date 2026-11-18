/** Tests for the platform-limit message chunker. */
import { describe, expect, it } from 'vitest'
import { chunkMessage } from './chunk'

describe('chunkMessage', () => {
  it('returns empty for blank input', () => {
    expect(chunkMessage('', 100)).toEqual([])
    expect(chunkMessage('   \n ', 100)).toEqual([])
  })

  it('returns a single chunk when under the limit (no numbering)', () => {
    expect(chunkMessage('hello world', 100)).toEqual(['hello world'])
    const exact = 'a'.repeat(100)
    expect(chunkMessage(exact, 100)).toEqual([exact])
  })

  it('splits at paragraph boundaries when possible', () => {
    const para1 = 'first paragraph. '.repeat(10).trim()
    const para2 = 'second paragraph. '.repeat(10).trim()
    const chunks = chunkMessage(`${para1}\n\n${para2}`, 220)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toBe(`${para1} (1/2)`)
    expect(chunks[1]).toBe(`${para2} (2/2)`)
  })

  it('splits at line boundaries when no paragraph break fits', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line number ${i}`).join('\n')
    const chunks = chunkMessage(lines, 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(60)
      expect(c).toMatch(/\(\d+\/\d+\)$/)
    }
  })

  it('hard-splits unbroken text and numbers every chunk', () => {
    const blob = 'x'.repeat(250)
    const chunks = chunkMessage(blob, 100)
    expect(chunks.length).toBe(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100)
    expect(chunks[0]).toMatch(/^x+ \(1\/3\)$/)
    expect(chunks[2]).toMatch(/\(3\/3\)$/)
  })

  it('never exceeds the limit including the suffix', () => {
    const text = ('word '.repeat(500) + '\n\n').repeat(3)
    for (const c of chunkMessage(text, 300)) {
      expect(c.length).toBeLessThanOrEqual(300)
    }
  })
})
