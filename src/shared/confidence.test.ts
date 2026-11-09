/** Tests for the confidence marker parser and transcript helpers. */
import { describe, expect, it } from 'vitest'
import {
  latestConfidence,
  parseConfidenceMarker,
  stripConfidenceLine,
  CONFIDENCE_GUIDANCE
} from './confidence'
import type { StoredMessage } from './ui-message'

function assistant(text: string, id = 'a1'): StoredMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }], createdAt: 1 }
}

describe('parseConfidenceMarker', () => {
  it('parses the canonical em-dash form', () => {
    expect(parseConfidenceMarker('CONFIDENCE: green — requirements are clear')).toEqual({
      level: 'green',
      reason: 'requirements are clear'
    })
  })

  it('parses hyphen and colon separators', () => {
    expect(parseConfidenceMarker('CONFIDENCE: yellow - some unknowns')).toEqual({
      level: 'yellow',
      reason: 'some unknowns'
    })
    expect(parseConfidenceMarker('Confidence: red: missing API docs')).toEqual({
      level: 'red',
      reason: 'missing API docs'
    })
  })

  it('is case-insensitive and tolerates bold markdown', () => {
    expect(parseConfidenceMarker('**Confidence:** GREEN — all good')).toEqual({
      level: 'green',
      reason: 'all good'
    })
    expect(parseConfidenceMarker('**CONFIDENCE: yellow — fuzzy scope**')).toEqual({
      level: 'yellow',
      reason: 'fuzzy scope'
    })
  })

  it('tolerates a traffic-light emoji and missing reason', () => {
    expect(parseConfidenceMarker('CONFIDENCE: 🟢 green — ship it')).toEqual({
      level: 'green',
      reason: 'ship it'
    })
    expect(parseConfidenceMarker('CONFIDENCE: red')).toEqual({ level: 'red', reason: '' })
  })

  it('finds the marker inside surrounding text', () => {
    const text = 'Here is my analysis.\n\nCONFIDENCE: yellow — the schema is undocumented\n\nNext…'
    expect(parseConfidenceMarker(text)).toEqual({
      level: 'yellow',
      reason: 'the schema is undocumented'
    })
  })

  it('rejects non-markers', () => {
    expect(parseConfidenceMarker('I have high confidence in this approach')).toBeNull()
    expect(parseConfidenceMarker('confidence: very high')).toBeNull()
    expect(parseConfidenceMarker('The green button toggles confidence')).toBeNull()
    expect(parseConfidenceMarker('')).toBeNull()
  })

  it('rejects markers not at the start of a line', () => {
    expect(parseConfidenceMarker('My CONFIDENCE: green — inline mention')).toBeNull()
  })
})

describe('stripConfidenceLine', () => {
  it('removes the marker line and collapses blank runs', () => {
    const text = 'Intro.\n\nCONFIDENCE: green — clear task\n\nBody continues.'
    expect(stripConfidenceLine(text)).toBe('Intro.\n\nBody continues.')
  })

  it('returns the text unchanged when no marker is present', () => {
    const text = 'Nothing to strip here.'
    expect(stripConfidenceLine(text)).toBe(text)
  })

  it('round-trips with the parser', () => {
    const text = 'CONFIDENCE: red — missing context\nActual answer.'
    expect(parseConfidenceMarker(text)).not.toBeNull()
    const stripped = stripConfidenceLine(text)
    expect(parseConfidenceMarker(stripped)).toBeNull()
    expect(stripped).toBe('Actual answer.')
  })
})

describe('latestConfidence', () => {
  it('returns null for an empty or markerless transcript', () => {
    expect(latestConfidence([])).toBeNull()
    expect(latestConfidence([assistant('no marker')])).toBeNull()
  })

  it('returns the last marker across the transcript', () => {
    const messages: StoredMessage[] = [
      assistant('CONFIDENCE: red — just started', 'a1'),
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'clarified' }], createdAt: 2 },
      assistant('CONFIDENCE: green — all clear now', 'a2')
    ]
    expect(latestConfidence(messages)).toEqual({ level: 'green', reason: 'all clear now' })
  })

  it('ignores markers in user messages', () => {
    const messages: StoredMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'CONFIDENCE: red — spoofed' }],
        createdAt: 1
      }
    ]
    expect(latestConfidence(messages)).toBeNull()
  })
})

describe('CONFIDENCE_GUIDANCE', () => {
  it('describes the exact marker shape the parser accepts', () => {
    expect(CONFIDENCE_GUIDANCE).toContain('CONFIDENCE: green|yellow|red')
    expect(parseConfidenceMarker('CONFIDENCE: green — example')).not.toBeNull()
  })
})
