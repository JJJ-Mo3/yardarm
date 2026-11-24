import { describe, expect, it } from 'vitest'
import { describePendingSetup, filterIssues, filterPrs, hasPendingSetup } from './new-chat-sources'

const none = { pendingSetupCommands: [], pendingCopyFiles: [], pendingTeardownCommands: [] }

describe('hasPendingSetup', () => {
  it('is true when any list is pending', () => {
    expect(hasPendingSetup(none)).toBe(false)
    expect(hasPendingSetup({ ...none, pendingCopyFiles: ['.env'] })).toBe(true)
    expect(hasPendingSetup({ ...none, pendingTeardownCommands: ['make down'] })).toBe(true)
  })
})

describe('describePendingSetup', () => {
  it('lists the copy patterns and teardown commands alongside the setup commands', () => {
    const text = describePendingSetup({
      pendingSetupCommands: ['npm install'],
      pendingCopyFiles: ['.env.local', 'config/*.local.json'],
      pendingTeardownCommands: ['docker compose down']
    })
    expect(text).toContain('npm install')
    expect(text).toContain('.env.local\nconfig/*.local.json')
    expect(text).toContain('docker compose down')
    expect(text).toContain('.yardarm/worktree.json')
  })

  it('omits empty sections', () => {
    const text = describePendingSetup({ ...none, pendingCopyFiles: ['.env'] })
    expect(text).toContain('Files to copy')
    expect(text).not.toContain('Setup commands')
    expect(text).not.toContain('Teardown commands')
  })
})

describe('filterIssues / filterPrs', () => {
  const issues = [
    { number: 12, title: 'Fix login redirect', author: 'octo', labels: ['bug'] },
    { number: 120, title: 'Add dark mode', author: 'hubot', labels: ['feature', 'ui'] },
    { number: 7, title: 'Docs typo', author: 'octo', labels: [] }
  ]
  const prs = [
    { number: 34, title: 'Dark mode', author: 'hubot', headRefName: 'feature/dark' },
    { number: 35, title: 'Bump deps', author: 'bot', headRefName: 'deps/update' }
  ]

  it('returns everything for an empty query', () => {
    expect(filterIssues(issues, '  ')).toEqual(issues)
    expect(filterPrs(prs, '')).toEqual(prs)
  })

  it('matches numbers by prefix, with or without # or !', () => {
    expect(filterIssues(issues, '12').map((i) => i.number)).toEqual([12, 120])
    expect(filterIssues(issues, '#7').map((i) => i.number)).toEqual([7])
    expect(filterPrs(prs, '!35').map((p) => p.number)).toEqual([35])
  })

  it('matches title, author, labels and head branch case-insensitively', () => {
    expect(filterIssues(issues, 'DARK').map((i) => i.number)).toEqual([120])
    expect(filterIssues(issues, 'octo').map((i) => i.number)).toEqual([12, 7])
    expect(filterIssues(issues, 'ui').map((i) => i.number)).toEqual([120])
    expect(filterPrs(prs, 'deps/').map((p) => p.number)).toEqual([35])
    expect(filterPrs(prs, 'nothing')).toEqual([])
  })
})
