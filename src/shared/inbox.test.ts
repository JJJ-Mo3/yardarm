import { describe, expect, it } from 'vitest'
import {
  buildInboxGroups,
  inboxAttentionCount,
  summarizeSuspension,
  summarizeToolArgs,
  type InboxLiveEntry,
  type InboxUnseenEntry
} from './inbox'

function live(over: Partial<InboxLiveEntry> & { subchatId: string }): InboxLiveEntry {
  return {
    chatId: `chat-${over.subchatId}`,
    chatTitle: `Chat ${over.subchatId}`,
    projectId: 'p1',
    projectName: 'Project',
    running: false,
    runningSince: null,
    approvals: [],
    questions: [],
    ...over
  }
}

function unseen(chatId: string, finishedAt: number): InboxUnseenEntry {
  return { chatId, chatTitle: chatId, projectId: 'p1', projectName: 'Project', finishedAt }
}

describe('buildInboxGroups', () => {
  it('omits empty groups and keeps the fixed group order', () => {
    expect(buildInboxGroups({ live: [], unseen: [] })).toEqual([])
    const groups = buildInboxGroups({
      live: [
        live({ subchatId: 'r', running: true, runningSince: 10 }),
        live({
          subchatId: 'a',
          running: true,
          approvals: [{ toolCallId: 't', toolName: 'shell', args: {}, since: 5 }]
        })
      ],
      unseen: [unseen('done', 20)]
    })
    expect(groups.map((g) => g.id)).toEqual(['approval', 'finished', 'running'])
    expect(groups.map((g) => g.label)).toEqual([
      'Needs approval',
      'Finished — not viewed',
      'Running'
    ])
  })

  it('puts a subchat in exactly one group: approval, then question, then running', () => {
    const groups = buildInboxGroups({
      live: [
        live({
          subchatId: 'both',
          running: true,
          runningSince: 1,
          approvals: [{ toolCallId: 't', toolName: 'shell', args: {}, since: 9 }],
          questions: [{ toolCallId: 'q', toolName: 'ask_user', summary: 'Which?', since: 3 }]
        }),
        live({
          subchatId: 'q',
          running: true,
          runningSince: 1,
          questions: [{ toolCallId: 'q', toolName: 'ask_user', summary: 'Which?', since: 3 }]
        }),
        live({ subchatId: 'idle' })
      ],
      unseen: []
    })
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.subchatId)])).toEqual([
      ['approval', ['both']],
      ['question', ['q']]
    ])
    expect(groups[1].rows[0].questions).toEqual(['Which?'])
  })

  it('drops unseen chats that are live again and sorts by age', () => {
    const groups = buildInboxGroups({
      live: [
        live({ subchatId: 's2', chatId: 'c-live', running: true, runningSince: 50 }),
        live({ subchatId: 's1', chatId: 'c-old', running: true, runningSince: 10 })
      ],
      unseen: [unseen('c-live', 99), unseen('older', 5), unseen('newer', 8)]
    })
    const finished = groups.find((g) => g.id === 'finished')
    expect(finished?.rows.map((r) => r.chatId)).toEqual(['newer', 'older'])
    const running = groups.find((g) => g.id === 'running')
    expect(running?.rows.map((r) => r.chatId)).toEqual(['c-old', 'c-live'])
  })

  it('counts everything but running rows as needing attention', () => {
    const groups = buildInboxGroups({
      live: [
        live({ subchatId: 'r', running: true, runningSince: 1 }),
        live({
          subchatId: 'a',
          approvals: [{ toolCallId: 't', toolName: 'shell', args: {}, since: 5 }]
        })
      ],
      unseen: [unseen('x', 1)]
    })
    expect(inboxAttentionCount(groups)).toBe(2)
  })
})

describe('summarizeToolArgs', () => {
  it('prefers the most telling argument', () => {
    expect(summarizeToolArgs({ command: 'pnpm   test\n--run', cwd: '/x' })).toBe('pnpm test --run')
    expect(summarizeToolArgs({ path: 'src/a.ts', content: 'x'.repeat(500) })).toBe('src/a.ts')
  })

  it('parses JSON strings, truncates, and tolerates odd values', () => {
    expect(summarizeToolArgs('{"url":"https://example.com"}')).toBe('https://example.com')
    expect(summarizeToolArgs('not json')).toBe('not json')
    expect(summarizeToolArgs({ a: 1 })).toBe('{"a":1}')
    expect(summarizeToolArgs(null)).toBe('')
    expect(summarizeToolArgs({ command: 'y'.repeat(300) }, 20)).toHaveLength(20)
  })
})

describe('summarizeSuspension', () => {
  it('summarizes the known interactive tools', () => {
    expect(summarizeSuspension('ask_user', { question: 'Which  database?' })).toBe(
      'Which database?'
    )
    expect(summarizeSuspension('ask_user', null)).toBe('The agent has a question.')
    expect(summarizeSuspension('submit_plan', { title: 'Refactor auth' })).toBe(
      'Plan ready for review: Refactor auth'
    )
    expect(summarizeSuspension('request_access', { path: '/tmp/x' })).toBe(
      'Requests sandbox access to /tmp/x'
    )
    expect(summarizeSuspension('custom_tool', {})).toBe('custom_tool is waiting for your input')
  })
})
