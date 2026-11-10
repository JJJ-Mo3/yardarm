import { describe, expect, it } from 'vitest'
import {
  buildKnowledgeBlock,
  formatTriggeredNotes,
  KNOWLEDGE_BLOCK_PREFIX,
  KNOWLEDGE_LOOKUP_TOOL_NAME,
  matchTriggeredNotes,
  MAX_NOTE_BODY_CHARS,
  MAX_NOTES,
  MAX_PINNED_BYTES,
  MAX_TRIGGER_INJECT_BYTES,
  parseSuggestedKnowledge,
  parseTriggers,
  planKnowledgeBoot,
  stripSuggestedKnowledgeLine,
  type TriggerNote
} from './knowledge-notes'

const note = (
  id: string,
  pinned: boolean,
  body = `body of ${id}`
): { id: string; title: string; body: string; pinned: boolean } => ({
  id,
  title: `title ${id}`,
  body,
  pinned
})

describe('buildKnowledgeBlock', () => {
  it('returns null when there are no notes', () => {
    expect(buildKnowledgeBlock([], [])).toBeNull()
  })

  it('inlines pinned bodies and indexes lookup notes by id', () => {
    const block = buildKnowledgeBlock(
      [{ id: 'a', title: 'Use pnpm', body: 'Always use pnpm, never npm.' }],
      [{ id: 'b', title: 'Deploy steps', body: 'long body' }]
    )
    expect(block).not.toBeNull()
    expect(block!.startsWith(KNOWLEDGE_BLOCK_PREFIX)).toBe(true)
    expect(block).toContain('- Use pnpm: Always use pnpm, never npm.')
    expect(block).toContain('- Deploy steps (id: b)')
    expect(block).not.toContain('long body')
    expect(block).toContain(KNOWLEDGE_LOOKUP_TOOL_NAME)
  })

  it('is byte-identical for identical inputs (prefix stability)', () => {
    const pinned = [{ id: 'a', title: 't', body: 'b' }]
    expect(buildKnowledgeBlock(pinned, [])).toBe(buildKnowledgeBlock(pinned, []))
  })
})

describe('planKnowledgeBoot', () => {
  it('splits pinned and unpinned notes preserving order', () => {
    const plan = planKnowledgeBoot([note('a', true), note('b', false), note('c', true)])
    expect(plan.pinned.map((n) => n.id)).toEqual(['a', 'c'])
    expect(plan.lookup.map((n) => n.id)).toEqual(['b'])
  })

  it('caps the total number of notes at MAX_NOTES', () => {
    const notes = Array.from({ length: MAX_NOTES + 10 }, (_, i) => note(`n${i}`, false))
    const plan = planKnowledgeBoot(notes)
    expect(plan.pinned.length + plan.lookup.length).toBe(MAX_NOTES)
  })

  it('demotes pinned overflow past the byte budget to lookup', () => {
    const big = 'x'.repeat(3000)
    const plan = planKnowledgeBoot([
      note('a', true, big),
      note('b', true, big),
      note('c', true, 'small')
    ])
    expect(plan.pinned.map((n) => n.id)).toEqual(['a', 'c'])
    expect(plan.lookup.map((n) => n.id)).toEqual(['b'])
    const bytes = plan.pinned.reduce((sum, n) => sum + Buffer.byteLength(n.body, 'utf8'), 0)
    expect(bytes).toBeLessThanOrEqual(MAX_PINNED_BYTES)
  })

  it('clamps oversized bodies defensively', () => {
    const plan = planKnowledgeBoot([note('a', false, 'y'.repeat(MAX_NOTE_BODY_CHARS + 500))])
    expect(plan.lookup[0].body.length).toBe(MAX_NOTE_BODY_CHARS)
  })

  it('counts multibyte characters as UTF-8 bytes for the pinned budget', () => {
    // 1500 × 3-byte chars = 4500 bytes > MAX_PINNED_BYTES even though 1500 chars.
    const plan = planKnowledgeBoot([note('a', true, '\u20AC'.repeat(1500))])
    expect(plan.pinned).toEqual([])
    expect(plan.lookup.map((n) => n.id)).toEqual(['a'])
  })
})

describe('parseSuggestedKnowledge', () => {
  it('parses a plain marker line', () => {
    expect(
      parseSuggestedKnowledge('All done.\nSuggested knowledge: Tests live under src/__tests__.')
    ).toBe('Tests live under src/__tests__.')
  })

  it('tolerates bold, casing, and separator variants', () => {
    expect(parseSuggestedKnowledge('**Suggested Knowledge** — Use pnpm, never npm here.')).toBe(
      'Use pnpm, never npm here.'
    )
    expect(parseSuggestedKnowledge('> suggested knowledge: The API client retries twice.')).toBe(
      'The API client retries twice.'
    )
  })

  it('returns the last marker when several appear', () => {
    const text = 'Suggested knowledge: first durable fact.\nSuggested knowledge: second one wins.'
    expect(parseSuggestedKnowledge(text)).toBe('second one wins.')
  })

  it('ignores markers inside code fences', () => {
    const text = '```\nSuggested knowledge: inside a fence, not real.\n```\nDone.'
    expect(parseSuggestedKnowledge(text)).toBeNull()
  })

  it('ignores mid-line mentions and short payloads', () => {
    expect(parseSuggestedKnowledge('I added the Suggested knowledge: marker support.')).toBeNull()
    expect(parseSuggestedKnowledge('Suggested knowledge: none')).toBeNull()
  })

  it('returns null when absent', () => {
    expect(parseSuggestedKnowledge('Nothing to see here.')).toBeNull()
  })
})

const triggerNote = (id: string, triggers: string | null, pinned = false): TriggerNote => ({
  id,
  title: `title ${id}`,
  body: `body of ${id}`,
  pinned,
  triggers
})

describe('parseTriggers', () => {
  it('splits, trims, lowercases, and dedupes keywords', () => {
    expect(parseTriggers(' Deploy, STAGING , deploy,,migrations ')).toEqual([
      'deploy',
      'staging',
      'migrations'
    ])
  })

  it('returns an empty list for null or blank input', () => {
    expect(parseTriggers(null)).toEqual([])
    expect(parseTriggers('  , ,')).toEqual([])
  })
})

describe('matchTriggeredNotes', () => {
  it('matches whole words case-insensitively', () => {
    const notes = [triggerNote('a', 'deploy'), triggerNote('b', 'staging')]
    const hits = matchTriggeredNotes('How do I Deploy this?', notes)
    expect(hits.map((n) => n.id)).toEqual(['a'])
  })

  it('does not match keyword substrings', () => {
    const hits = matchTriggeredNotes('redeployment plan', [triggerNote('a', 'deploy')])
    expect(hits).toEqual([])
  })

  it('skips pinned notes and notes without triggers', () => {
    const notes = [triggerNote('a', 'deploy', true), triggerNote('b', null)]
    expect(matchTriggeredNotes('deploy now', notes)).toEqual([])
  })

  it('escapes regex metacharacters in keywords', () => {
    const hits = matchTriggeredNotes('run foo.bar() today', [triggerNote('a', 'foo.bar()')])
    expect(hits.map((n) => n.id)).toEqual(['a'])
    expect(matchTriggeredNotes('fooXbar', [triggerNote('b', 'foo.bar')])).toEqual([])
  })

  it('caps cumulative injected bytes, preserving input order', () => {
    // Two max-size bodies fill 8000 of the 8192-byte budget; a 500-byte note
    // overflows and is skipped, while a tiny later note still fits.
    const big = 'x'.repeat(MAX_NOTE_BODY_CHARS)
    const notes: TriggerNote[] = [
      { ...triggerNote('a', 'deploy'), body: big },
      { ...triggerNote('b', 'deploy'), body: big },
      { ...triggerNote('c', 'deploy'), body: 'y'.repeat(500) },
      { ...triggerNote('d', 'deploy'), body: 'small' }
    ]
    expect(2 * big.length + 500).toBeGreaterThan(MAX_TRIGGER_INJECT_BYTES)
    const hits = matchTriggeredNotes('deploy', notes)
    expect(hits.map((n) => n.id)).toEqual(['a', 'b', 'd'])
  })

  it('clamps oversized bodies to the per-note cap', () => {
    const notes = [{ ...triggerNote('a', 'deploy'), body: 'z'.repeat(MAX_NOTE_BODY_CHARS + 50) }]
    const hits = matchTriggeredNotes('deploy', notes)
    expect(hits[0].body.length).toBe(MAX_NOTE_BODY_CHARS)
  })
})

describe('formatTriggeredNotes', () => {
  it('returns null for no matches', () => {
    expect(formatTriggeredNotes([])).toBeNull()
  })

  it('lists each note as a title: body line', () => {
    const text = formatTriggeredNotes([
      { id: 'a', title: 'Deploys', body: 'Use the deploy script.' }
    ])
    expect(text).toContain('Knowledge notes matched by this prompt')
    expect(text).toContain('- Deploys: Use the deploy script.')
  })
})

describe('stripSuggestedKnowledgeLine', () => {
  it('removes the marker line and collapses blank runs', () => {
    const text = 'Done with the task.\n\nSuggested knowledge: The db schema lives in db/schema.ts.'
    expect(stripSuggestedKnowledgeLine(text)).toBe('Done with the task.')
  })

  it('leaves fenced content untouched', () => {
    const text =
      'Suggested knowledge: Durable fact to keep.\n```\nSuggested knowledge: keep me verbatim\n```'
    const stripped = stripSuggestedKnowledgeLine(text)
    expect(stripped).toContain('keep me verbatim')
    expect(stripped.startsWith('```')).toBe(true)
  })

  it('returns text unchanged when no marker exists', () => {
    const text = 'Plain reply.'
    expect(stripSuggestedKnowledgeLine(text)).toBe(text)
  })
})
