/** Tests for the /review argument parser, prompt templates, and marker helpers. */
import { describe, expect, it } from 'vitest'
import type { StoredMessage } from '../../../../shared/ui-message'
import {
  buildLocalReviewPrompt,
  buildPlanFromReviewPrompt,
  buildPrCommentsPrompt,
  buildPrListPrompt,
  buildPrReviewPrompt,
  buildReviewMarker,
  findCompletedReview,
  parseReviewArgs,
  parseReviewMarker
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

describe('review markers', () => {
  it('round-trips a local review', () => {
    const marker = buildReviewMarker({ kind: 'local' })
    expect(marker).toBe('Review: local changes')
    expect(parseReviewMarker(marker)).toEqual({ kind: 'local' })
  })

  it('round-trips a PR review with and without a title', () => {
    const withTitle = buildReviewMarker({ kind: 'pr', prNumber: '42', title: 'fix auth' })
    expect(withTitle).toBe('Review: PR #42 — fix auth')
    expect(parseReviewMarker(withTitle)).toEqual({ kind: 'pr', prNumber: '42' })
    const bare = buildReviewMarker({ kind: 'pr', prNumber: '7' })
    expect(bare).toBe('Review: PR #7')
    expect(parseReviewMarker(bare)).toEqual({ kind: 'pr', prNumber: '7' })
  })

  it('rejects non-review text, follow-up markers, and the list marker', () => {
    expect(parseReviewMarker('hello')).toBeNull()
    expect(parseReviewMarker('Review follow-up: post PR comments')).toBeNull()
    expect(parseReviewMarker('Review follow-up: build a plan')).toBeNull()
    expect(parseReviewMarker('Review: list open PRs')).toBeNull()
    expect(parseReviewMarker('Review: PR #abc')).toBeNull()
  })
})

describe('follow-up prompts', () => {
  it('PR comments prompt interpolates the number and uses gh comment-only commands', () => {
    const prompt = buildPrCommentsPrompt('42')
    expect(prompt).toContain('The PR is #42.')
    expect(prompt).toContain('gh pr review <number> --comment --body')
    expect(prompt).toContain('gh pr comment <number> --body')
    expect(prompt).not.toContain('gh pr view --json number')
  })

  it('PR comments prompt resolves the branch PR when no number is given', () => {
    const prompt = buildPrCommentsPrompt()
    expect(prompt).toContain('gh pr view --json number')
  })

  it('plan prompt turns the findings into an implementation plan', () => {
    const prompt = buildPlanFromReviewPrompt()
    expect(prompt).toContain('implementation plan')
    expect(prompt).toContain('Present the plan for approval')
  })
})

describe('findCompletedReview', () => {
  const msg = (
    role: 'user' | 'assistant',
    text: string,
    opts?: { marker?: boolean; id?: string }
  ): StoredMessage => ({
    id: opts?.id ?? `${role}-${text}`,
    role,
    parts: [{ type: 'text', text, ...(opts?.marker ? { marker: true } : {}) }],
    createdAt: 0
  })

  it('returns null for an empty transcript', () => {
    expect(findCompletedReview([])).toBeNull()
  })

  it('returns null when the review has no assistant reply yet', () => {
    expect(findCompletedReview([msg('user', 'Review: local changes', { marker: true })])).toBeNull()
  })

  it('finds a completed local review', () => {
    const messages = [
      msg('user', 'Review: local changes', { marker: true, id: 'm1' }),
      msg('assistant', 'Here is the review…')
    ]
    expect(findCompletedReview(messages)).toEqual({ markerId: 'm1', target: { kind: 'local' } })
  })

  it('finds a completed PR review and strips the title', () => {
    const messages = [
      msg('user', 'Review: PR #42 — fix auth', { marker: true, id: 'm1' }),
      msg('assistant', 'Verdict: approve')
    ]
    expect(findCompletedReview(messages)).toEqual({
      markerId: 'm1',
      target: { kind: 'pr', prNumber: '42' }
    })
  })

  it('returns null when a plain user message came after the review', () => {
    const messages = [
      msg('user', 'Review: local changes', { marker: true }),
      msg('assistant', 'Here is the review…'),
      msg('user', 'thanks, now fix it')
    ]
    expect(findCompletedReview(messages)).toBeNull()
  })

  it('returns null for old non-marker messages that merely look like markers', () => {
    const messages = [msg('user', 'Review: local changes'), msg('assistant', 'ok')]
    expect(findCompletedReview(messages)).toBeNull()
  })
})
