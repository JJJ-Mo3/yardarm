/** Tests for the wiki generation prompt. */
import { describe, expect, it } from 'vitest'
import { buildWikiPrompt } from './wiki'

describe('buildWikiPrompt', () => {
  it('targets the staging folder with index + module pages and citations', () => {
    const prompt = buildWikiPrompt()
    expect(prompt).toContain('.yardarm-wiki/')
    expect(prompt).toContain('index.md')
    expect(prompt).toContain('mermaid')
    expect(prompt).toContain('meta.json')
    expect(prompt).toContain('repo-relative paths')
  })
})
