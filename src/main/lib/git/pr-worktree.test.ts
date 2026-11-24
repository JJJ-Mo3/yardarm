/**
 * Exercises createPrWorktree against a local bare repository standing in for
 * the forge (it serves `refs/pull/<n>/head` like GitHub does). Electron is
 * stubbed only for the userData path the worktrees live under.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yardarm-pr-'))

vi.mock('electron', () => ({ app: { getPath: () => path.join(tmp, 'userData') } }))

const { createPrWorktree } = await import('./pr-worktree')

const origin = path.join(tmp, 'origin.git')
const seed = path.join(tmp, 'seed')
const project = path.join(tmp, 'project')
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.com']

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function commit(cwd: string, file: string, message: string): string {
  fs.writeFileSync(path.join(cwd, file), message)
  git(cwd, ['add', '.'])
  git(cwd, [...ID, 'commit', '-q', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD']).trim()
}

let featureSha = ''
let forkSha = ''

beforeAll(() => {
  git(tmp, ['init', '-q', '--bare', '-b', 'main', origin])
  git(tmp, ['init', '-q', '-b', 'main', seed])
  git(seed, ['remote', 'add', 'origin', origin])
  commit(seed, 'a.txt', 'base')
  git(seed, ['push', '-q', 'origin', 'main'])
  // Same-repo PR #5 from feature/x.
  git(seed, ['checkout', '-q', '-b', 'feature/x'])
  featureSha = commit(seed, 'b.txt', 'feature work')
  git(seed, ['push', '-q', 'origin', 'feature/x', 'feature/x:refs/pull/5/head'])
  // Fork PR #7: only the read-only pull ref exists on origin.
  git(seed, ['checkout', '-q', '-b', 'fork-work', 'main'])
  forkSha = commit(seed, 'c.txt', 'fork work')
  git(seed, ['push', '-q', 'origin', 'fork-work:refs/pull/7/head'])
  git(tmp, ['clone', '-q', origin, project])
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('createPrWorktree', () => {
  it('checks out a same-repo PR on its own branch, tracking origin', async () => {
    const wt = await createPrWorktree('p', project, 'chat-1', {
      provider: 'github',
      number: 5,
      headRefName: 'feature/x',
      crossRepo: false,
      baseBranch: 'main'
    })
    expect(wt.branch).toBe('feature/x')
    expect(wt.baseBranch).toBe('main')
    expect(wt.worktreePath).toBe(path.join(tmp, 'userData', 'worktrees', 'p', 'chat-1'))
    expect(git(wt.worktreePath, ['rev-parse', 'HEAD']).trim()).toBe(featureSha)
    expect(
      git(wt.worktreePath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).trim()
    ).toBe('origin/feature/x')
  })

  it('falls back to the pull ref when the head branch is already checked out', async () => {
    const wt = await createPrWorktree('p', project, 'chat-2', {
      provider: 'github',
      number: 5,
      headRefName: 'feature/x',
      crossRepo: false,
      baseBranch: 'main'
    })
    expect(wt.branch).toBe('yardarm/pr-5')
    expect(git(wt.worktreePath, ['rev-parse', 'HEAD']).trim()).toBe(featureSha)
  })

  it('fetches a fork PR through the read-only pull ref', async () => {
    const wt = await createPrWorktree('p', project, 'chat-3', {
      provider: 'github',
      number: 7,
      headRefName: 'fork-work',
      crossRepo: true,
      baseBranch: 'main'
    })
    expect(wt.branch).toBe('yardarm/pr-7')
    expect(git(wt.worktreePath, ['rev-parse', 'HEAD']).trim()).toBe(forkSha)
    // A second chat on the same PR gets its own branch name.
    const again = await createPrWorktree('p', project, 'chat-4', {
      provider: 'github',
      number: 7,
      headRefName: 'fork-work',
      crossRepo: true,
      baseBranch: 'main'
    })
    expect(again.branch).toBe('yardarm/pr-7-2')
  })

  it('never passes a hostile head branch name to git', async () => {
    const marker = path.join(tmp, 'pwned')
    const wt = await createPrWorktree('p', project, 'chat-5', {
      provider: 'github',
      number: 7,
      headRefName: `--upload-pack=touch ${marker}`,
      crossRepo: false,
      baseBranch: 'main'
    })
    expect(wt.branch).toBe('yardarm/pr-7-3')
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('rejects a non-integer PR number and a PR that does not exist', async () => {
    const base = {
      provider: 'github' as const,
      headRefName: 'x',
      crossRepo: true,
      baseBranch: 'main'
    }
    await expect(
      createPrWorktree('p', project, 'chat-6', { ...base, number: 1.5 })
    ).rejects.toThrow('Invalid pull request number')
    await expect(
      createPrWorktree('p', project, 'chat-7', { ...base, number: 999 })
    ).rejects.toThrow()
    expect(fs.existsSync(path.join(tmp, 'userData', 'worktrees', 'p', 'chat-7'))).toBe(false)
  })
})
