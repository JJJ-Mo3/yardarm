import { describe, expect, it } from 'vitest'
import {
  COMPRESSION_MARKER,
  DIFF_CONTEXT_KEEP,
  EXCERPT_HEAD_CHARS,
  EXCERPT_TAIL_CHARS,
  JSON_ARRAY_KEEP,
  JSON_ARRAY_TAIL_KEEP,
  LINE_REPEAT_MIN,
  LOG_DUP_RUN_MIN,
  PROGRESS_RUN_MIN,
  STACK_FRAME_MIN,
  STACK_HEAD_FRAMES,
  STACK_TAIL_FRAMES,
  VERBOSITY_SUFFIX,
  applyVerbositySteering,
  collapseRepeatedLines,
  compressPrompt,
  compressUnifiedDiff,
  crushLog,
  detectContentType,
  stripAnsi,
  stripHtml,
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

  // Provider-executed (server-side) tool results, e.g. Anthropic web_search:
  // the provider re-serializes them into special blocks (web_search_tool_result)
  // and silently drops rewritten ones, orphaning the tool_use.
  const SEARCH_RESULTS = Array.from({ length: 40 }, (_, i) => ({
    url: `https://example.com/${i}`,
    title: `Result ${i}`,
    pageAge: null,
    encryptedContent: 'e'.repeat(400),
    type: 'web_search_result'
  }))

  function serverSearchTurn(opts?: { flagOnResult?: boolean }): CompressiblePromptMessage {
    const call: Record<string, unknown> = {
      type: 'tool-call',
      toolCallId: 'srv-1',
      toolName: 'web_search',
      input: { query: 'x' }
    }
    const result: Record<string, unknown> = {
      type: 'tool-result',
      toolCallId: 'srv-1',
      toolName: 'web_search',
      output: { type: 'json', value: SEARCH_RESULTS }
    }
    if (opts?.flagOnResult) result.providerExecuted = true
    else call.providerExecuted = true
    return { role: 'assistant', content: [call, result, { type: 'text', text: 'found it' }] }
  }

  it('never touches provider-executed tool results (flag on the tool call)', () => {
    const prompt = [
      user('turn 1'),
      serverSearchTurn(),
      user('turn 2'),
      assistant('ok'),
      user('turn 3'),
      assistant('ok'),
      user('turn 4'),
      assistant('ok')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(false)
    expect(result.prompt).toBe(prompt)
    expect(result.originals).toEqual([])
  })

  it('never touches provider-executed tool results (flag on the result part)', () => {
    const prompt = [
      user('turn 1'),
      serverSearchTurn({ flagOnResult: true }),
      user('turn 2'),
      assistant('ok'),
      user('turn 3'),
      assistant('ok'),
      user('turn 4'),
      assistant('ok')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(false)
    expect(result.prompt).toBe(prompt)
  })

  it('still compresses client tool results alongside a provider-executed pair', () => {
    const serverTurn = serverSearchTurn()
    const prompt = [
      user('turn 1'),
      serverTurn,
      toolResult('shell', { type: 'text', value: BIG }),
      assistant('done'),
      user('turn 2'),
      assistant('ok'),
      user('turn 3'),
      assistant('ok'),
      user('turn 4'),
      assistant('ok')
    ]
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    expect(result.prompt[1]).toBe(serverTurn)
    const value = outputOf(result.prompt[2]).value as string
    expect(value).toContain(COMPRESSION_MARKER)
    expect(result.originals.map((o) => o.toolName)).toEqual(['shell'])
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

/** old-turn scaffold: one stale tool output + enough user turns to unprotect it */
function oldToolPrompt(output: { type: string; value: unknown }): CompressiblePromptMessage[] {
  return [
    user('turn 1'),
    toolResult('shell', output),
    user('turn 2'),
    user('turn 3'),
    user('turn 4')
  ]
}

function contextLines(n: number, tag: string): string[] {
  return Array.from({ length: n }, (_, i) => ` context ${tag} line ${i} ${'pad '.repeat(10)}`)
}

function bigDiff(): string {
  return [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,40 +1,41 @@',
    ...contextLines(20, 'one'),
    '-const removed = 1',
    '+const added = 2',
    ...contextLines(20, 'two'),
    '@@ -100,30 +101,31 @@',
    ...contextLines(12, 'three'),
    '+const alsoAdded = 3',
    ...contextLines(12, 'four')
  ].join('\n')
}

describe('detectContentType', () => {
  it('detects git and bare unified diffs', () => {
    expect(detectContentType(bigDiff())).toBe('diff')
    const bare = ['--- a/x', '+++ b/x', '@@ -1,2 +1,3 @@', ' ctx', '+added'].join('\n')
    expect(detectContentType(bare)).toBe('diff')
  })

  it('classifies a diff of an HTML file as diff (order: diff before html)', () => {
    const diffOfHtml = [
      'diff --git a/index.html b/index.html',
      '@@ -1,6 +1,6 @@',
      ' <!DOCTYPE html>',
      ' <html><head><title>x</title></head>',
      '-<p>old</p>',
      '+<p>new</p>',
      ' <div><span>a</span><span>b</span></div>',
      ' </html>'
    ].join('\n')
    expect(detectContentType(diffOfHtml)).toBe('diff')
  })

  it('detects HTML via doctype and via tag density', () => {
    expect(detectContentType('<!DOCTYPE html><html><body>hi</body></html>')).toBe('html')
    const fragment = Array.from(
      { length: 10 },
      (_, i) => `<div class="row"><span>cell ${i}</span></div>`
    ).join('\n')
    expect(detectContentType(fragment)).toBe('html')
  })

  it('detects logs via timestamps, level prefixes and CR progress rewrites', () => {
    const stamped = Array.from(
      { length: 10 },
      (_, i) => `2024-01-01 12:00:0${i % 10} INFO server event ${i}`
    ).join('\n')
    expect(detectContentType(stamped)).toBe('log')
    const leveled = Array.from({ length: 10 }, (_, i) => `WARN something happened ${i}`).join('\n')
    expect(detectContentType(leveled)).toBe('log')
    expect(detectContentType('downloading\r10%\r20%\r30%\ndone')).toBe('log')
  })

  it('classifies prose and sparse tags as plain', () => {
    expect(detectContentType('This is a paragraph about a < b and other prose.\nMore text.')).toBe(
      'plain'
    )
    const sparse = 'Some prose with an occasional <b>tag</b> in it.\n' + 'plain line\n'.repeat(20)
    expect(detectContentType(sparse)).toBe('plain')
  })
})

describe('crushLog', () => {
  it('keeps only the final CR-rewritten segment per line', () => {
    const crushed = crushLog('fetching\rprogress 10%\rprogress 99%\ndone')
    expect(crushed).toBe('progress 99%\ndone')
  })

  it('collapses timestamp-varying duplicate lines to first + marker', () => {
    const lines = Array.from(
      { length: LOG_DUP_RUN_MIN + 1 },
      (_, i) => `2024-01-01 12:00:0${i} INFO cache warmed`
    )
    const crushed = crushLog(lines.join('\n'))
    expect(crushed).toBe(
      `${lines[0]}\n${COMPRESSION_MARKER}: previous line repeated ${LOG_DUP_RUN_MIN} more times]`
    )
  })

  it('collapses digit-only-varying progress lines to first + marker + last', () => {
    const lines = Array.from({ length: PROGRESS_RUN_MIN + 2 }, (_, i) => `downloaded ${i * 10}%`)
    const crushed = crushLog(lines.join('\n'))
    expect(crushed).toBe(
      `${lines[0]}\n${COMPRESSION_MARKER}: ${PROGRESS_RUN_MIN} similar progress lines omitted]\n${lines[lines.length - 1]}`
    )
  })

  it('leaves short progress runs alone', () => {
    const short = Array.from({ length: PROGRESS_RUN_MIN - 1 }, (_, i) => `step ${i}`).join('\n')
    expect(crushLog(short)).toBe(short)
  })

  it('trims long stack traces to head + tail frames', () => {
    const frames = Array.from(
      { length: STACK_FRAME_MIN + 2 },
      (_, i) => `    at fn${i} (/app/src/file${i}.ts:${i}:1)`
    )
    const crushed = crushLog(`Error: boom\n${frames.join('\n')}\nrethrown`)
    const out = crushed.split('\n')
    expect(out[0]).toBe('Error: boom')
    expect(out.slice(1, 1 + STACK_HEAD_FRAMES)).toEqual(frames.slice(0, STACK_HEAD_FRAMES))
    const omitted = frames.length - STACK_HEAD_FRAMES - STACK_TAIL_FRAMES
    expect(out[1 + STACK_HEAD_FRAMES]).toBe(
      `${COMPRESSION_MARKER}: ${omitted} stack frames omitted]`
    )
    expect(out.slice(-3, -1)).toEqual(frames.slice(-STACK_TAIL_FRAMES))
    expect(out[out.length - 1]).toBe('rethrown')
  })

  it('returns the same reference when nothing collapses', () => {
    const text = 'line one\nline two\nline three'
    expect(crushLog(text)).toBe(text)
  })
})

describe('compressUnifiedDiff', () => {
  it('preserves headers and all +/- lines while trimming context runs', () => {
    const diff = bigDiff()
    const out = compressUnifiedDiff(diff, 100_000)
    expect(out.length).toBeLessThan(diff.length)
    expect(out).toContain('diff --git a/src/a.ts b/src/a.ts')
    expect(out).toContain('@@ -1,40 +1,41 @@')
    expect(out).toContain('@@ -100,30 +101,31 @@')
    expect(out).toContain('-const removed = 1')
    expect(out).toContain('+const added = 2')
    expect(out).toContain('+const alsoAdded = 3')
    expect(out).toContain('context lines omitted]')
    // Each 20-line context run keeps DIFF_CONTEXT_KEEP per edge.
    expect(out).toContain(' context one line 0')
    expect(out).toContain(` context one line ${DIFF_CONTEXT_KEEP - 1}`)
    expect(out).toContain(' context one line 19')
    expect(out).not.toContain(' context one line 5')
  })

  it('drops whole trailing hunks when over budget but keeps the first hunk', () => {
    const out = compressUnifiedDiff(bigDiff(), 400)
    expect(out).toContain('@@ -1,40 +1,41 @@')
    expect(out).toContain('+const added = 2')
    expect(out).not.toContain('@@ -100,30 +101,31 @@')
    expect(out).not.toContain('+const alsoAdded = 3')
    expect(out).toContain('1 more hunks omitted]')
  })

  it('returns non-diff or unshrinkable input unchanged', () => {
    const notDiff = 'just some text\nwith lines'
    expect(compressUnifiedDiff(notDiff, 10)).toBe(notDiff)
    const tiny = ['diff --git a/x b/x', '@@ -1,1 +1,1 @@', '-a', '+b'].join('\n')
    expect(compressUnifiedDiff(tiny, 100_000)).toBe(tiny)
  })
})

describe('stripHtml', () => {
  it('strips tags, scripts, styles, comments and decodes entities', () => {
    const html =
      '<!DOCTYPE html><html><head><style>body{color:red}</style>' +
      '<script>var x = "<div>";</script></head><body>' +
      '<!-- comment --><h1>Title</h1><p>Hello &amp; welcome &#65;&#x42; &nbsp;end</p>' +
      '<ul><li>one</li><li>two</li></ul></body></html>'
    const out = stripHtml(html)
    expect(out).not.toContain('<')
    expect(out).not.toContain('color:red')
    expect(out).not.toContain('var x')
    expect(out).not.toContain('comment')
    expect(out).toContain('Title')
    expect(out).toContain('Hello & welcome AB')
    expect(out).toContain('one')
    expect(out).toContain('two')
  })

  it('turns block closers into newlines and collapses blank runs', () => {
    const out = stripHtml('<div>a</div><div>b</div><br><br><br><div>c</div>')
    expect(out).toBe('a\nb\n\nc')
  })

  it('leaves unknown entities and out-of-range codepoints alone', () => {
    expect(stripHtml('&bogus; &#99999999; stays')).toBe('&bogus; &#99999999; stays')
  })
})

describe('compressPrompt content-type routing', () => {
  it('compacts big diffs structurally instead of slicing mid-hunk', () => {
    const diff = bigDiff()
    expect(diff.length).toBeGreaterThan(EXCERPT_HEAD_CHARS + EXCERPT_TAIL_CHARS + 200)
    const prompt = oldToolPrompt({ type: 'text', value: diff })
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    const value = outputOf(result.prompt[1]).value as string
    expect(value.startsWith('diff --git a/src/a.ts')).toBe(true)
    expect(value).toContain('+const added = 2')
    expect(value).toContain('+const alsoAdded = 3')
    expect(value).toContain('unified diff compacted')
    expect(value).toContain('retrieve_full_output')
    expect(value.length).toBeLessThan(diff.length)
    expect(result.originals).toEqual([{ toolCallId: 'call-1', toolName: 'shell', text: diff }])
  })

  it('strips big HTML outputs to their text content', () => {
    const html =
      '<!DOCTYPE html><html><body>' +
      Array.from({ length: 30 }, (_, i) => `<p>paragraph &amp; number ${i}</p>`).join('') +
      '</body></html>'
    const prompt = oldToolPrompt({ type: 'text', value: html })
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    const value = outputOf(result.prompt[1]).value as string
    expect(value).not.toContain('<p>')
    expect(value).toContain('paragraph & number 3')
    expect(result.originals[0].text).toBe(html)
  })

  it('crushes log outputs (timestamped duplicates) before line collapse', () => {
    const noisy = Array.from(
      { length: 12 },
      (_, i) => `2024-01-01 12:00:${String(i).padStart(2, '0')} INFO retrying connection`
    ).join('\n')
    const prompt = oldToolPrompt({ type: 'text', value: noisy })
    const result = compressPrompt(prompt, opts)
    expect(result.changed).toBe(true)
    const value = outputOf(result.prompt[1]).value as string
    expect(value).toContain('2024-01-01 12:00:00 INFO retrying connection')
    expect(value).toContain('previous line repeated 11 more times')
    expect(value).not.toContain('12:00:07')
  })

  it('is idempotent across passes for routed content', () => {
    const prompt = oldToolPrompt({ type: 'text', value: bigDiff() })
    const first = compressPrompt(prompt, opts)
    const second = compressPrompt(first.prompt, opts)
    expect(second.changed).toBe(false)
    expect(second.prompt).toBe(first.prompt)
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
