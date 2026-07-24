/** Tests for the /review argument parser and prompt templates. */
import { describe, expect, it } from 'vitest'
import {
  buildLocalReviewPrompt,
  buildPrListPrompt,
  buildPrReviewPrompt,
  parseReviewArgs
} from './review-prompts'

describe('parseReviewArgs', () => {
  it('returns list for empty args', () => {
    expect(parseReviewArgs('')).toEqual({ kind: 'list' })
    expect(parseReviewArgs('   ')).toEqual({ kind: 'list' })
  })

  it('parses a PR number with optional focus', () => {
    expect(parseReviewArgs('123')).toEqual({ kind: 'pr', prNumber: '123', focus: undefined })
    expect(parseReviewArgs('#123 security')).toEqual({
      kind: 'pr',
      prNumber: '123',
      focus: 'security'
    })
  })

  it('parses changes with optional focus', () => {
    expect(parseReviewArgs('changes')).toEqual({ kind: 'changes', focus: undefined })
    expect(parseReviewArgs('changes error handling')).toEqual({
      kind: 'changes',
      focus: 'error handling'
    })
  })

  it('rejects anything else', () => {
    expect(parseReviewArgs('foo')).toEqual({ kind: 'invalid' })
    expect(parseReviewArgs('12a')).toEqual({ kind: 'invalid' })
  })
})

describe('prompt templates', () => {
  it('PR list prompt matches the CLI text', () => {
    expect(buildPrListPrompt()).toBe(
      "List the open pull requests for this repository using `gh pr list --limit 20`. Present them in a clear table with PR number, title, and author. Then ask me which PR I'd like you to review."
    )
  })

  it('PR review prompt matches the CLI structure and interpolates the number', () => {
    const prompt = buildPrReviewPrompt('42')
    expect(prompt).toContain('Do a thorough code review of PR #42.')
    expect(prompt).toContain('1. Run `gh pr view 42` to get the PR description and metadata.')
    expect(prompt).toContain('2. Run `gh pr diff 42` to get the full diff.')
    expect(prompt).toContain('3. Run `gh pr checks 42` to check CI status.')
    expect(prompt).toContain('Final verdict (approve/request changes/comment)')
    expect(prompt).not.toContain('Pay special attention to')
  })

  it('appends the focus suffix like the CLI', () => {
    expect(buildPrReviewPrompt('42', 'security')).toContain(
      '\nPay special attention to: security\n'
    )
    expect(buildLocalReviewPrompt({ focus: 'tests' })).toContain(
      '\nPay special attention to: tests\n'
    )
  })

  it('local prompt uses the base branch when known', () => {
    const prompt = buildLocalReviewPrompt({ baseBranch: 'main' })
    expect(prompt).toContain('git diff main...HEAD')
    expect(prompt).not.toContain('symbolic-ref')
  })

  it('local prompt tells the agent to detect the base branch when unknown', () => {
    const prompt = buildLocalReviewPrompt()
    expect(prompt).toContain('git symbolic-ref refs/remotes/origin/HEAD')
    expect(prompt).toContain('git diff <base>...HEAD')
  })
})
