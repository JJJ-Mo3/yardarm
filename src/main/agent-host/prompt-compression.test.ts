import { describe, expect, it } from 'vitest'
import {
  COMPRESSION_MARKER,
  EXCERPT_HEAD_CHARS,
  EXCERPT_TAIL_CHARS,
  JSON_ARRAY_KEEP,
  compressPrompt,
  type CompressiblePromptMessage
} from './prompt-compression'

const estimate = (text: string): number => Math.ceil(text.length / 4)
const opts = { estimate }

function user(text: string): CompressiblePromptMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistant(text: string): CompressiblePromptMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function toolResult(
  toolName: string,
  output: { type: string; value: unknown },
  toolCallId = 'call-1'
): CompressiblePromptMessage {
  return { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName, output }] }
}

const BIG = 'x'.repeat(10_000)

/** old turn with a big tool output + enough recent user turns to unprotect it */
function promptWithOldBigResult(): CompressiblePromptMessage[] {
  return [
    { role: 'system', content: 'sys' },
    user('turn 1'),
    toolResult('shell', { type: 'text', value: BIG }),
    assistant('done'),
    user('turn 2'),
    assistant('ok'),
    user('turn 3'),
    assistant('ok'),
    user('turn 4'),
    assistant('ok')
  ]
}

function outputOf(msg: CompressiblePromptMessage): { type: string; value: unknown } {
  const content = msg.content as Array<{ output: { type: string; value: unknown } }>
  return content[0].output
}

describe('compressPrompt', () => {
  it('returns the original reference with fewer than K user turns', () => {
    const prompt = [user('one'), toolResult('shell', { type: 'text', value: BIG }), user('two')]
    const result = compressPrompt(prompt, opts)
    expect(result.prompt).toBe(prompt)
    expect(result.changed).toBe(false)
    expect(result.tokensSaved).toBe(0)
  })

  it('excerpts a big old tool output with the marker and omitted count', () => {
    const prompt = promptWithOldBigResult()
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    const value = outputOf(result.prompt[2]).value as string
    expect(outputOf(result.prompt[2]).type).toBe('text')
    expect(value).toContain(COMPRESSION_MARKER)
    const omitted = BIG.length - EXCERPT_HEAD_CHARS - EXCERPT_TAIL_CHARS
    expect(value).toContain(`${omitted} chars omitted`)
    expect(value.length).toBeLessThan(BIG.length)
    expect(result.tokensSaved).toBe(estimate(BIG) - estimate(value))
  })

  it('protects tool results in the recent user-turn window', () => {
    const prompt = [
      user('turn 1'),
      user('turn 2'),
      user('turn 3'),
      user('turn 4'),
      toolResult('shell', { type: 'text', value: BIG })
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(false)
    expect(result.prompt).toBe(prompt)
  })

  it('never touches system or user messages', () => {
    const prompt = promptWithOldBigResult()
    const result = compressPrompt(prompt, opts)
    expect(result.prompt[0]).toBe(prompt[0])
    expect(result.prompt[1]).toBe(prompt[1])
    expect(result.prompt[4]).toBe(prompt[4])
  })

  it('is deterministic and idempotent', () => {
    const prompt = promptWithOldBigResult()
    const first = compressPrompt(prompt, opts)
    const again = compressPrompt(prompt, opts)
    expect(again.prompt).toEqual(first.prompt)
    const second = compressPrompt(first.prompt, opts)
    expect(second.changed).toBe(false)
    expect(second.prompt).toBe(first.prompt)
  })

  it('is prefix-stable as new turns are appended', () => {
    const prompt = promptWithOldBigResult()
    const before = compressPrompt(prompt, opts)
    const extended = [...prompt, user('turn 5'), assistant('ok')]
    const after = compressPrompt(extended, opts)
    for (let i = 0; i < prompt.length; i++) {
      expect(JSON.stringify(after.prompt[i])).toBe(JSON.stringify(before.prompt[i]))
    }
  })

  it('stubs later duplicates and keeps the first occurrence', () => {
    const prompt = [
      user('turn 1'),
      toolResult('shell', { type: 'text', value: 'same output '.repeat(50) }, 'a'),
      toolResult('shell', { type: 'text', value: 'same output '.repeat(50) }, 'b'),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    expect(outputOf(result.prompt[1]).value).toBe('same output '.repeat(50))
    const stub = outputOf(result.prompt[2]).value as string
    expect(stub).toContain(COMPRESSION_MARKER)
    expect(stub).toContain('identical to an earlier shell result')
  })

  it('does not stub identical output from a different tool', () => {
    const prompt = [
      user('turn 1'),
      toolResult('shell', { type: 'text', value: 'same output '.repeat(50) }, 'a'),
      toolResult('read', { type: 'text', value: 'same output '.repeat(50) }, 'b'),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(false)
  })

  it('crushes big homogeneous JSON arrays and keeps the json type', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item ${i}` }))
    const prompt = [
      user('turn 1'),
      toolResult('search', { type: 'json', value: items }),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    const output = outputOf(result.prompt[1])
    expect(output.type).toBe('json')
    const value = output.value as unknown[]
    expect(value).toHaveLength(JSON_ARRAY_KEEP + 1)
    expect(value.slice(0, JSON_ARRAY_KEEP)).toEqual(items.slice(0, JSON_ARRAY_KEEP))
    expect(value[JSON_ARRAY_KEEP]).toContain(`${50 - JSON_ARRAY_KEEP} more items omitted`)
  })

  it('leaves heterogeneous and short JSON arrays alone', () => {
    const prompt = [
      user('turn 1'),
      toolResult('a', { type: 'json', value: [...Array.from({ length: 30 }, (_, i) => i), 'x'] }),
      toolResult('b', { type: 'json', value: Array.from({ length: 10 }, (_, i) => i) }, 'c2'),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(false)
  })

  it('keeps the error variant when excerpting error output', () => {
    const prompt = [
      user('turn 1'),
      toolResult('shell', { type: 'error-text', value: BIG }),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    expect(outputOf(result.prompt[1]).type).toBe('error-text')
  })

  it('skips media-bearing content outputs', () => {
    const prompt = [
      user('turn 1'),
      toolResult('screenshot', {
        type: 'content',
        value: [
          { type: 'text', text: BIG },
          { type: 'media', data: BIG, mediaType: 'image/png' }
        ]
      }),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(false)
    expect(result.prompt).toBe(prompt)
  })

  it('keeps reference identity for untouched messages', () => {
    const prompt = promptWithOldBigResult()
    const result = compressPrompt(prompt, opts)
    expect(result.prompt).not.toBe(prompt)
    for (let i = 0; i < prompt.length; i++) {
      if (i === 2) expect(result.prompt[i]).not.toBe(prompt[i])
      else expect(result.prompt[i]).toBe(prompt[i])
    }
  })
})
