import { describe, expect, it } from 'vitest'
import { stripAgentMarkers } from './agent-markers'
import { parseConfidenceMarker } from './confidence'
import { parseFollowUps } from './follow-ups'
import { parseSuggestedKnowledge } from './knowledge-notes'

describe('stripAgentMarkers', () => {
  const reply = [
    'CONFIDENCE: green — small, well-understood change',
    'I renamed the helper and updated its callers.',
    'Suggested knowledge: Use pnpm, not npm, in this repo.',
    'Follow-up: Add a test for the renamed helper',
    'Follow-up: Update the changelog entry'
  ].join('\n')

  it('recognizes the sample as carrying all three markers', () => {
    expect(parseConfidenceMarker(reply)).not.toBeNull()
    expect(parseSuggestedKnowledge(reply)).not.toBeNull()
    expect(parseFollowUps(reply).length).toBe(2)
  })

  it('removes every marker line and keeps the prose', () => {
    const out = stripAgentMarkers(reply)
    expect(out).toContain('I renamed the helper and updated its callers.')
    expect(parseConfidenceMarker(out)).toBeNull()
    expect(parseSuggestedKnowledge(out)).toBeNull()
    expect(parseFollowUps(out)).toEqual([])
    expect(out).not.toMatch(/CONFIDENCE:|Suggested knowledge|Follow-up:/i)
  })

  it('leaves marker-free text unchanged', () => {
    expect(stripAgentMarkers('Just a plain answer.')).toBe('Just a plain answer.')
  })
})
