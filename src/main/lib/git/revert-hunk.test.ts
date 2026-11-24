/**
 * Integration tests for per-hunk revert and conflict detection against real
 * temporary repositories (plain git, no Electron).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileHunks, gitStatus, mergeIntoBase, MergeConflictError, pull, revertHunk } from './ops'

let repo = ''

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
}

function git(...args: string[]): string {
  return gitIn(repo, ...args)
}

function write(name: string, content: string): void {
  writeFileSync(path.join(repo, name), content)
}

function read(name: string): string {
  return readFileSync(path.join(repo, name), 'utf8')
}

const numbered = (n: number, eol = '\n'): string[] =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}${eol}`)

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'yardarm-revert-')))
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('config', 'user.name', 't')
  git('config', 'user.email', 't@example.com')
  git('config', 'commit.gpgsign', 'false')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('revertHunk', () => {
  it('reverts only the chosen hunk of a multi-hunk file', async () => {
    const base = numbered(40)
    write('a.txt', base.join(''))
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    const edited = [...base]
    edited[1] = 'CHANGED 2\n'
    edited[19] = 'CHANGED 20\n'
    edited[38] = 'CHANGED 39\n'
    write('a.txt', edited.join(''))

    const hunks = await fileHunks(repo, 'a.txt')
    expect(hunks).toHaveLength(3)
    expect(hunks[1]).toMatchObject({ anchorSide: 'new', anchorLine: 20 })
    await revertHunk(repo, 'a.txt', { index: 1, hash: hunks[1].hash })

    const expected = [...edited]
    expected[19] = base[19]
    expect(read('a.txt')).toBe(expected.join(''))
    // First and last hunks revert too, each against the refreshed diff.
    const rest = await fileHunks(repo, 'a.txt')
    expect(rest).toHaveLength(2)
    await revertHunk(repo, 'a.txt', { index: 1, hash: rest[1].hash })
    await revertHunk(repo, 'a.txt', { index: 0, hash: rest[0].hash })
    expect(read('a.txt')).toBe(base.join(''))
    expect(await fileHunks(repo, 'a.txt')).toEqual([])
  })

  it('rejects a stale hash without touching the file', async () => {
    write('a.txt', numbered(5).join(''))
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    write('a.txt', numbered(5).join('') + 'extra\n')
    const [hunk] = await fileHunks(repo, 'a.txt')
    write('a.txt', numbered(5).join('') + 'different\n')
    await expect(revertHunk(repo, 'a.txt', { index: 0, hash: hunk.hash })).rejects.toThrow(
      /changed since/
    )
    expect(read('a.txt')).toBe(numbered(5).join('') + 'different\n')
  })

  it('also unstages a reverted hunk that was staged', async () => {
    write('a.txt', numbered(5).join(''))
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    write('a.txt', numbered(5).join('') + 'extra\n')
    git('add', '-A')
    const [hunk] = await fileHunks(repo, 'a.txt')
    await revertHunk(repo, 'a.txt', { index: 0, hash: hunk.hash })
    expect((await gitStatus(repo)).files).toEqual([])
  })

  it('handles CRLF files and a missing final newline', async () => {
    const base = numbered(12, '\r\n').join('') + 'tail'
    write('w.txt', base)
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    write('w.txt', base.replace('line 2\r\n', 'TWO\r\n').replace(/tail$/, 'TAIL'))
    const hunks = await fileHunks(repo, 'w.txt')
    expect(hunks).toHaveLength(2)
    await revertHunk(repo, 'w.txt', { index: 1, hash: hunks[1].hash })
    expect(read('w.txt')).toBe(base.replace('line 2\r\n', 'TWO\r\n'))
    const [first] = await fileHunks(repo, 'w.txt')
    await revertHunk(repo, 'w.txt', { index: 0, hash: first.hash })
    expect(read('w.txt')).toBe(base)
  })

  it('restores deleted lines and offers nothing for new or untracked files', async () => {
    write('a.txt', numbered(6).join(''))
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    write('a.txt', numbered(6).slice(0, 3).join(''))
    write('untracked.txt', 'hi\n')
    write('added.txt', 'hi\n')
    git('add', 'added.txt')
    expect(await fileHunks(repo, 'untracked.txt')).toEqual([])
    expect(await fileHunks(repo, 'added.txt')).toEqual([])
    const [hunk] = await fileHunks(repo, 'a.txt')
    expect(hunk).toMatchObject({ anchorSide: 'old', anchorLine: 6, removed: 3 })
    await revertHunk(repo, 'a.txt', { index: 0, hash: hunk.hash })
    expect(read('a.txt')).toBe(numbered(6).join(''))
  })

  it('reverts against a base ref without touching the index', async () => {
    write('a.txt', numbered(5).join(''))
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()
    write('a.txt', numbered(5).join('') + 'committed\n')
    git('commit', '-q', '-am', 'second')
    const [hunk] = await fileHunks(repo, 'a.txt', baseSha)
    await revertHunk(repo, 'a.txt', { index: 0, hash: hunk.hash, baseRef: baseSha })
    expect(read('a.txt')).toBe(numbered(5).join(''))
    expect((await gitStatus(repo)).files).toEqual([{ path: 'a.txt', status: ' M', staged: false }])
  })

  it('refuses paths outside the working tree', async () => {
    await expect(revertHunk(repo, '../x.txt', { index: 0, hash: 'x' })).rejects.toThrow(/escapes/)
  })
})

describe('conflict detection', () => {
  function diverge(): void {
    write('a.txt', 'base\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    git('checkout', '-q', '-b', 'feature')
    write('a.txt', 'feature\n')
    git('commit', '-q', '-am', 'feature')
    git('checkout', '-q', 'main')
    write('a.txt', 'main\n')
    git('commit', '-q', '-am', 'main')
  }

  it('aborts a conflicted merge into base and reports the files', async () => {
    diverge()
    for (const squash of [false, true]) {
      const err = await mergeIntoBase(repo, 'feature', 'main', { squash }).catch((e) => e)
      expect(err).toBeInstanceOf(MergeConflictError)
      expect((err as MergeConflictError).files).toEqual(['a.txt'])
      expect((await gitStatus(repo)).files).toEqual([])
      expect(read('a.txt')).toBe('main\n')
    }
  })

  it('aborts a conflicted pull and reports the files', async () => {
    write('a.txt', 'base\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    const remote = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'yardarm-remote-')))
    try {
      gitIn(remote, 'clone', '-q', '--bare', repo, 'origin.git')
      git('remote', 'add', 'origin', path.join(remote, 'origin.git'))
      git('push', '-q', '-u', 'origin', 'main')
      const other = path.join(remote, 'other')
      gitIn(remote, 'clone', '-q', path.join(remote, 'origin.git'), 'other')
      writeFileSync(path.join(other, 'a.txt'), 'theirs\n')
      gitIn(other, 'commit', '-q', '-am', 'theirs')
      gitIn(other, 'push', '-q', 'origin', 'main')
      write('a.txt', 'ours\n')
      git('commit', '-q', '-am', 'ours')
      git('config', 'pull.rebase', 'false')
      const err = await pull(repo).catch((e) => e)
      expect(err).toBeInstanceOf(MergeConflictError)
      expect((err as MergeConflictError).files).toEqual(['a.txt'])
      expect(read('a.txt')).toBe('ours\n')
      expect((await gitStatus(repo)).files).toEqual([])
    } finally {
      rmSync(remote, { recursive: true, force: true })
    }
  })
})
