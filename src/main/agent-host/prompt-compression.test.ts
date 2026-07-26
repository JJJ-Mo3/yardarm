import { describe, expect, it } from 'vitest'
import {
  COMPRESSION_MARKER,
  EXCERPT_HEAD_CHARS,
  EXCERPT_TAIL_CHARS,
  JSON_ARRAY_KEEP,
  JSON_ARRAY_TAIL_KEEP,
  LINE_REPEAT_MIN,
  VERBOSITY_SUFFIX,
  applyVerbositySteering,
  collapseRepeatedLines,
  compressPrompt,
  stripAnsi,
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

  it('crushes big homogeneous JSON arrays keeping head, tail and the json type', () => {
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
    expect(value).toHaveLength(JSON_ARRAY_KEEP + 1 + JSON_ARRAY_TAIL_KEEP)
    expect(value.slice(0, JSON_ARRAY_KEEP)).toEqual(items.slice(0, JSON_ARRAY_KEEP))
    const omitted = 50 - JSON_ARRAY_KEEP - JSON_ARRAY_TAIL_KEEP
    expect(value[JSON_ARRAY_KEEP]).toContain(`${omitted} more items omitted`)
    expect(value.slice(-JSON_ARRAY_TAIL_KEEP)).toEqual(items.slice(-JSON_ARRAY_TAIL_KEEP))
  })

  it('preserves error-like items when crushing arrays', () => {
    const items: unknown[] = Array.from({ length: 50 }, (_, i) => ({ id: i, status: 'ok' }))
    items[25] = { id: 25, status: 'error', message: 'boom' }
    const prompt = [
      user('turn 1'),
      toolResult('search', { type: 'json', value: items }),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    const value = outputOf(result.prompt[1]).value as unknown[]
    expect(value).toContainEqual({ id: 25, status: 'error', message: 'boom' })
  })

  it('crushes homogeneous arrays nested one level inside a JSON object', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: i }))
    const prompt = [
      user('turn 1'),
      toolResult('query', { type: 'json', value: { total: 40, rows } }),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    const output = outputOf(result.prompt[1])
    expect(output.type).toBe('json')
    const value = output.value as { total: number; rows: unknown[] }
    expect(value.total).toBe(40)
    expect(value.rows).toHaveLength(JSON_ARRAY_KEEP + 1 + JSON_ARRAY_TAIL_KEEP)
    expect(JSON.stringify(value.rows[JSON_ARRAY_KEEP])).toContain(COMPRESSION_MARKER)
  })

  it('strips ANSI escapes and collapses repeated lines in old text outputs', () => {
    const noisy =
      '\u001b[32mbuilding\u001b[0m\n' +
      Array.from({ length: 20 }, () => 'progress tick').join('\n') +
      '\ndone\n' +
      'padding '.repeat(60)
    const prompt = [
      user('turn 1'),
      toolResult('shell', { type: 'text', value: noisy }),
      user('turn 2'),
      user('turn 3'),
      user('turn 4')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    const value = outputOf(result.prompt[1]).value as string
    expect(value).not.toContain('\u001b[')
    expect(value).toContain('building')
    expect(value).toContain('progress tick')
    expect(value).toContain('repeated 19 more times')
    expect(result.tokensSaved).toBeGreaterThan(0)
  })

  it('reports originals with toolCallId for rewritten results', () => {
    const prompt = promptWithOldBigResult()
    const result = compressPrompt(prompt, opts)
    expect(result.originals).toEqual([{ toolCallId: 'call-1', toolName: 'shell', text: BIG }])
    const value = outputOf(result.prompt[2]).value as string
    expect(value).toContain('retrieve_full_output')
    expect(value).toContain('call-1')
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

describe('stripAnsi', () => {
  it('removes CSI and OSC sequences and is idempotent', () => {
    const input = '\u001b[1;32mok\u001b[0m \u001b]0;title\u0007text \u001b[2K\u001b[1Gline'
    const stripped = stripAnsi(input)
    expect(stripped).toBe('ok text line')
    expect(stripAnsi(stripped)).toBe(stripped)
  })
})

describe('collapseRepeatedLines', () => {
  it('collapses runs at/above the threshold and leaves shorter runs alone', () => {
    const below = Array.from({ length: LINE_REPEAT_MIN - 1 }, () => 'tick').join('\n')
    expect(collapseRepeatedLines(below)).toBe(below)
    const at = Array.from({ length: LINE_REPEAT_MIN }, () => 'tick').join('\n')
    const collapsed = collapseRepeatedLines(at)
    expect(collapsed).toBe(
      `tick\n${COMPRESSION_MARKER}: previous line repeated ${LINE_REPEAT_MIN - 1} more times]`
    )
  })
})

describe('applyVerbositySteering', () => {
  it('appends the suffix to the system message once, copy-on-write', () => {
    const prompt: CompressiblePromptMessage[] = [{ role: 'system', content: 'sys' }, user('hi')]
    const first = applyVerbositySteering(prompt)
    expect(first.changed).toBe(true)
    expect(first.prompt[0].content).toBe('sys\n\n' + VERBOSITY_SUFFIX)
    expect(first.prompt[1]).toBe(prompt[1])
    expect(prompt[0].content).toBe('sys')
    const second = applyVerbositySteering(first.prompt)
    expect(second.changed).toBe(false)
    expect(second.prompt).toBe(first.prompt)
  })

  it('is a no-op without a string-content system message', () => {
    const noSystem = applyVerbositySteering([user('hi')])
    expect(noSystem.changed).toBe(false)
    const arrayContent = applyVerbositySteering([
      { role: 'system', content: [{ type: 'text', text: 'sys' }] }
    ])
    expect(arrayContent.changed).toBe(false)
  })
})
