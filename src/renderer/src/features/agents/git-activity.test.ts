import { describe, expect, it } from 'vitest'
import { detectGitActivity } from './git-activity'
import type { StoredMessage, ToolCallPart } from '../../../../shared/ui-message'

function shellCall(
  command: string,
  status: ToolCallPart['status'] = 'success',
  toolName = 'execute_command'
): ToolCallPart {
  return { type: 'tool-call', toolCallId: 't1', toolName, args: { command }, status }
}

function msg(parts: StoredMessage['parts']): StoredMessage {
  return { id: 'm1', role: 'assistant', parts, createdAt: 0 }
}

describe('detectGitActivity', () => {
  it('counts commits and pushes across chained commands', () => {
    const m = msg([shellCall('git add -A && git commit -m "fix" && git push origin main')])
    expect(detectGitActivity(m)).toEqual({
      commits: 1,
      pushes: 1,
      merges: 0,
      branchSwitch: null
    })
  })

  it('counts multiple commits across separate calls', () => {
    const m = msg([shellCall('git commit -m one'), shellCall('git commit -m two; git push')])
    expect(detectGitActivity(m)).toMatchObject({ commits: 2, pushes: 1 })
  })

  it('handles -C dir and env-var prefixes', () => {
    const m = msg([shellCall('GIT_AUTHOR_NAME=x git -C /tmp/repo commit -m msg')])
    expect(detectGitActivity(m)).toMatchObject({ commits: 1 })
  })

  it('detects merges but not merge --abort', () => {
    expect(detectGitActivity(msg([shellCall('git merge feature')]))).toMatchObject({ merges: 1 })
    expect(detectGitActivity(msg([shellCall('git merge --abort')]))).toBeNull()
  })

  it('detects branch switches from checkout and switch', () => {
    expect(detectGitActivity(msg([shellCall('git checkout -b feat/x')]))).toMatchObject({
      branchSwitch: 'feat/x'
    })
    expect(detectGitActivity(msg([shellCall('git switch main')]))).toMatchObject({
      branchSwitch: 'main'
    })
  })

  it('ignores checkout -- <path> file restores', () => {
    expect(detectGitActivity(msg([shellCall('git checkout -- src/index.ts')]))).toBeNull()
    expect(detectGitActivity(msg([shellCall('git checkout .')]))).toBeNull()
  })

  it('ignores failed and non-shell tool calls', () => {
    expect(detectGitActivity(msg([shellCall('git commit -m x', 'error')]))).toBeNull()
    expect(
      detectGitActivity(msg([shellCall('git commit -m x', 'success', 'read_file')]))
    ).toBeNull()
  })

  it('returns null for non-git commands mentioning git', () => {
    expect(detectGitActivity(msg([shellCall('echo git push')]))).toBeNull()
    expect(detectGitActivity(msg([shellCall('pnpm test')]))).toBeNull()
  })

  it('returns null for messages without tool calls', () => {
    expect(detectGitActivity(msg([{ type: 'text', text: 'git push done' }]))).toBeNull()
  })
})
