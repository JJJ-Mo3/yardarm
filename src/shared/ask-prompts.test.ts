/** Tests for the /ask prompt and marker builders. */
import { describe, expect, it } from 'vitest'
import { buildAskMarker, buildAskPrompt } from './ask-prompts'

describe('buildAskMarker', () => {
  it('prefixes and collapses whitespace', () => {
    expect(buildAskMarker('  how does  rollback\nwork?  ')).toBe('Ask: how does rollback work?')
  })

  it('truncates long questions with an ellipsis', () => {
    const marker = buildAskMarker('x'.repeat(200))
    expect(marker.startsWith('Ask: ')).toBe(true)
    expect(marker.length).toBeLessThanOrEqual(86)
    expect(marker.endsWith('…')).toBe(true)
  })
})

describe('buildAskPrompt', () => {
  const prompt = buildAskPrompt('where are checkpoints stored?')

  it('includes the question', () => {
    expect(prompt).toContain('where are checkpoints stored?')
  })

  it('steers read-only behavior', () => {
    expect(prompt).toContain('read-only')
    expect(prompt).toContain('Do not create, modify, or delete any files')
    expect(prompt).toContain('no git commands that mutate the repo')
  })

  it('requires path:line citations without guessing', () => {
    expect(prompt).toContain('`src/main/index.ts:42`')
    expect(prompt).toContain('repo-relative path and line')
    expect(prompt).toContain('never guess')
  })

  it('includes the delivery note so the answer lands in the reply', () => {
    expect(prompt).toContain('your reply is the answer the user reads')
  })
})
