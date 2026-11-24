/** Tests for the remote messaging command parser. */
import { describe, expect, it } from 'vitest'
import { parseCommand, pickPending } from './commands'

describe('parseCommand', () => {
  it('parses bare commands case-insensitively', () => {
    expect(parseCommand('help')).toEqual({ kind: 'help' })
    expect(parseCommand('HELP')).toEqual({ kind: 'help' })
    expect(parseCommand('Projects')).toEqual({ kind: 'projects' })
    expect(parseCommand('  status  ')).toEqual({ kind: 'status' })
    expect(parseCommand('Unbind')).toEqual({ kind: 'unbind' })
  })

  it('parses chats with a project name (multi-word)', () => {
    expect(parseCommand('chats yardarm')).toEqual({ kind: 'chats', project: 'yardarm' })
    expect(parseCommand('chats my app')).toEqual({ kind: 'chats', project: 'my app' })
  })

  it('treats bare chats as a prompt', () => {
    expect(parseCommand('chats')).toEqual({ kind: 'prompt', text: 'chats' })
  })

  it('parses use with project then chat (chat may be multi-word)', () => {
    expect(parseCommand('use yardarm fix-login')).toEqual({
      kind: 'use',
      project: 'yardarm',
      chat: 'fix-login'
    })
    expect(parseCommand('USE yardarm login bug')).toEqual({
      kind: 'use',
      project: 'yardarm',
      chat: 'login bug'
    })
  })

  it('treats incomplete use as a prompt', () => {
    expect(parseCommand('use yardarm')).toEqual({ kind: 'prompt', text: 'use yardarm' })
  })

  it('parses new with optional title', () => {
    expect(parseCommand('new yardarm')).toEqual({
      kind: 'new',
      project: 'yardarm',
      title: undefined
    })
    expect(parseCommand('new yardarm Fix the login flow')).toEqual({
      kind: 'new',
      project: 'yardarm',
      title: 'Fix the login flow'
    })
    expect(parseCommand('new')).toEqual({ kind: 'prompt', text: 'new' })
  })

  it('parses approve/deny with aliases', () => {
    expect(parseCommand('approve')).toEqual({ kind: 'approve' })
    expect(parseCommand('Approve the thing')).toEqual({ kind: 'approve' })
    expect(parseCommand('yes')).toEqual({ kind: 'approve' })
    expect(parseCommand('deny')).toEqual({ kind: 'deny', reason: undefined })
    expect(parseCommand('deny too risky')).toEqual({ kind: 'deny', reason: 'too risky' })
    expect(parseCommand('no')).toEqual({ kind: 'deny', reason: undefined })
  })

  it('keeps yes/no with trailing words as prompts (no implicit approval)', () => {
    expect(parseCommand('yes, do that')).toEqual({ kind: 'prompt', text: 'yes, do that' })
    expect(parseCommand('no thanks, try the other way')).toEqual({
      kind: 'prompt',
      text: 'no thanks, try the other way'
    })
  })

  it('falls through to prompt for everything else', () => {
    expect(parseCommand('fix the flaky test in auth.spec.ts')).toEqual({
      kind: 'prompt',
      text: 'fix the flaky test in auth.spec.ts'
    })
    expect(parseCommand('')).toEqual({ kind: 'prompt', text: '' })
    expect(parseCommand('helpme understand this')).toEqual({
      kind: 'prompt',
      text: 'helpme understand this'
    })
  })
})

describe('numbered approve/deny', () => {
  it('parses a leading list number', () => {
    expect(parseCommand('approve 2')).toEqual({ kind: 'approve', index: 2 })
    expect(parseCommand('deny 3 too risky')).toEqual({
      kind: 'deny',
      index: 3,
      reason: 'too risky'
    })
    expect(parseCommand('deny 3')).toEqual({ kind: 'deny', index: 3, reason: undefined })
    expect(parseCommand('deny 2fast')).toEqual({ kind: 'deny', reason: '2fast' })
  })
})

describe('pickPending', () => {
  it('resolves a bare reply only when exactly one is pending', () => {
    expect(pickPending([], undefined)).toEqual({ error: 'none' })
    expect(pickPending(['a'], undefined)).toEqual({ ok: 'a' })
    expect(pickPending(['a', 'b'], undefined)).toEqual({ error: 'ambiguous' })
  })

  it('resolves by 1-based number and rejects out-of-range numbers', () => {
    expect(pickPending(['a', 'b'], 2)).toEqual({ ok: 'b' })
    expect(pickPending(['a', 'b'], 0)).toEqual({ error: 'range' })
    expect(pickPending(['a', 'b'], 3)).toEqual({ error: 'range' })
  })
})
