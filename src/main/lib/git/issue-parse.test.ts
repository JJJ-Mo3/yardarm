import { describe, expect, it } from 'vitest'
import {
  MAX_ISSUE_BODY_CHARS,
  buildIssuePrompt,
  isPositiveInt,
  isValidBranchName,
  issueChatTitle,
  parseGhIssue,
  parseGhIssueList,
  parseGhPrHead,
  parseGlabIssue,
  parseGlabIssueList,
  parseGlabMrHead,
  prChatTitle,
  prHeadRef
} from './issue-parse'

describe('isPositiveInt', () => {
  it('accepts only positive safe integers', () => {
    expect(isPositiveInt(12)).toBe(true)
    for (const bad of [0, -1, 1.5, NaN, Infinity, '12', null, undefined, 2 ** 60]) {
      expect(isPositiveInt(bad)).toBe(false)
    }
  })
})

describe('isValidBranchName', () => {
  it('accepts ordinary branch names', () => {
    for (const ok of ['main', 'feature/login', 'fix-123', 'user/a.b_c', 'release/1.2.x']) {
      expect(isValidBranchName(ok)).toBe(true)
    }
  })

  it('rejects names that could be read as options or break a refspec', () => {
    for (const bad of [
      '',
      '-b',
      '--upload-pack=x',
      'a b',
      'a:b',
      'a..b',
      'a~1',
      'a^',
      'a?',
      'a*',
      'a[1]',
      'a\\b',
      '/a',
      'a/',
      'a//b',
      '.hidden',
      'a/.b',
      'a.lock',
      'a@{1}',
      'a\nb',
      'HEAD',
      '@',
      'a.',
      42,
      null
    ]) {
      expect(isValidBranchName(bad)).toBe(false)
    }
  })
})

describe('prHeadRef', () => {
  it('builds the read-only head ref per provider', () => {
    expect(prHeadRef('github', 34)).toBe('refs/pull/34/head')
    expect(prHeadRef('gitlab', 7)).toBe('refs/merge-requests/7/head')
  })

  it('rejects non-integer numbers', () => {
    expect(() => prHeadRef('github', 1.5)).toThrow()
    expect(() => prHeadRef('github', -3)).toThrow()
  })
})

describe('gh parsers', () => {
  it('parses an issue list and drops malformed rows', () => {
    const stdout = JSON.stringify([
      {
        number: 12,
        title: 'Fix login',
        author: { login: 'octo' },
        url: 'https://github.com/o/r/issues/12',
        labels: [{ name: 'bug' }, { name: '' }, 'junk'],
        updatedAt: '2026-01-02T03:04:05Z'
      },
      { number: '13', title: 'string number' },
      { number: 14 },
      null
    ])
    expect(parseGhIssueList(stdout)).toEqual([
      {
        number: 12,
        title: 'Fix login',
        author: 'octo',
        url: 'https://github.com/o/r/issues/12',
        labels: ['bug'],
        updatedAt: '2026-01-02T03:04:05Z'
      },
      { number: 14, title: '', author: '', url: '', labels: [], updatedAt: '' }
    ])
  })

  it('throws on non-JSON or non-array list output', () => {
    expect(() => parseGhIssueList('not json')).toThrow('Unexpected gh issue list output')
    expect(() => parseGhIssueList('{}')).toThrow('Unexpected gh issue list output')
  })

  it('parses one issue and drops a non-http URL', () => {
    expect(
      parseGhIssue(
        JSON.stringify({
          number: 12,
          title: 'Fix login',
          body: 'Steps…',
          url: 'javascript:alert(1)',
          author: { login: 'octo' }
        })
      )
    ).toEqual({ number: 12, title: 'Fix login', body: 'Steps…', url: '', author: 'octo' })
    expect(() => parseGhIssue('[]')).toThrow()
    expect(() => parseGhIssue(JSON.stringify({ number: 'x' }))).toThrow()
  })

  it('parses a PR head and treats unknown cross-repo state as a fork', () => {
    const base = {
      number: 34,
      title: 'Add dark mode',
      url: 'https://github.com/o/r/pull/34',
      headRefName: 'feature/dark',
      baseRefName: 'main'
    }
    expect(parseGhPrHead(JSON.stringify({ ...base, isCrossRepository: false }))).toEqual({
      ...base,
      crossRepo: false
    })
    expect(parseGhPrHead(JSON.stringify({ ...base, isCrossRepository: true })).crossRepo).toBe(true)
    expect(parseGhPrHead(JSON.stringify(base)).crossRepo).toBe(true)
    expect(parseGhPrHead(JSON.stringify({ ...base, baseRefName: '--evil' })).baseRefName).toBeNull()
  })
})

describe('glab parsers', () => {
  it('parses an issue list', () => {
    const stdout = JSON.stringify([
      {
        iid: 5,
        title: 'Crash on start',
        author: { username: 'tanuki' },
        web_url: 'https://gitlab.com/g/p/-/issues/5',
        labels: ['bug', 3],
        updated_at: '2026-02-03T00:00:00Z'
      },
      { id: 99, title: 'no iid' }
    ])
    expect(parseGlabIssueList(stdout)).toEqual([
      {
        number: 5,
        title: 'Crash on start',
        author: 'tanuki',
        url: 'https://gitlab.com/g/p/-/issues/5',
        labels: ['bug'],
        updatedAt: '2026-02-03T00:00:00Z'
      }
    ])
  })

  it('parses one issue from its description field', () => {
    expect(
      parseGlabIssue(
        JSON.stringify({
          iid: 5,
          title: 'Crash',
          description: 'It crashes',
          web_url: 'https://gitlab.com/g/p/-/issues/5',
          author: { username: 'tanuki' }
        })
      )
    ).toEqual({
      number: 5,
      title: 'Crash',
      body: 'It crashes',
      url: 'https://gitlab.com/g/p/-/issues/5',
      author: 'tanuki'
    })
  })

  it('detects fork merge requests from the project ids', () => {
    const base = {
      iid: 7,
      title: 'MR',
      web_url: 'https://gitlab.com/g/p/-/merge_requests/7',
      source_branch: 'feature/x',
      target_branch: 'main'
    }
    const same = parseGlabMrHead(
      JSON.stringify({ ...base, source_project_id: 1, target_project_id: 1 })
    )
    expect(same).toEqual({
      number: 7,
      title: 'MR',
      url: 'https://gitlab.com/g/p/-/merge_requests/7',
      headRefName: 'feature/x',
      baseRefName: 'main',
      crossRepo: false
    })
    expect(
      parseGlabMrHead(JSON.stringify({ ...base, source_project_id: 2, target_project_id: 1 }))
        .crossRepo
    ).toBe(true)
    expect(parseGlabMrHead(JSON.stringify(base)).crossRepo).toBe(true)
  })
})

describe('titles and prompt', () => {
  it('builds chat titles and clamps long ones to a single line', () => {
    expect(issueChatTitle({ number: 12, title: 'Fix\n login' })).toBe('#12 Fix login')
    expect(prChatTitle('github', { number: 34, title: 'Add dark mode' })).toBe(
      'PR #34 Add dark mode'
    )
    expect(prChatTitle('gitlab', { number: 7, title: 'X' })).toBe('MR !7 X')
    expect(issueChatTitle({ number: 1, title: 'x'.repeat(500) }).length).toBe(120)
  })

  it('includes number, title, URL and body in the prefill', () => {
    const prompt = buildIssuePrompt({
      number: 12,
      title: 'Fix login',
      body: 'Steps to reproduce:\n1. Open the app',
      url: 'https://github.com/o/r/issues/12',
      author: 'octo'
    })
    expect(prompt).toContain('issue #12: Fix login')
    expect(prompt).toContain('https://github.com/o/r/issues/12')
    expect(prompt).toContain('Steps to reproduce:\n1. Open the app')
  })

  it('handles an empty body and truncates a huge one', () => {
    const empty = buildIssuePrompt({ number: 1, title: 'T', body: '  ', url: '', author: '' })
    expect(empty).toContain('(no description)')
    const huge = buildIssuePrompt({
      number: 1,
      title: 'T',
      body: 'x'.repeat(MAX_ISSUE_BODY_CHARS + 500),
      url: '',
      author: ''
    })
    expect(huge).toContain('[Issue body truncated')
    expect(huge.length).toBeLessThan(MAX_ISSUE_BODY_CHARS + 300)
  })
})
