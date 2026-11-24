import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyUntrackedFiles } from './copy-untracked'

let tmp: string
let project: string
let worktree: string

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function git(args: string[]): void {
  execFileSync('git', args, { cwd: project, stdio: 'ignore' })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yardarm-copy-'))
  project = path.join(tmp, 'project')
  worktree = path.join(tmp, 'worktree')
  fs.mkdirSync(project)
  fs.mkdirSync(worktree)
  git(['init', '-q'])
  write(project, 'tracked.env', 'tracked')
  write(project, 'config/app.json', '{}')
  git(['add', '.'])
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init'])
  write(project, '.env.local', 'SECRET=1')
  write(project, 'config/db.local.json', '{"db":1}')
  write(project, 'node_modules/pkg/.env.local', 'nope')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('copyUntrackedFiles', () => {
  it('copies untracked matches and leaves tracked files to git', async () => {
    const report = await copyUntrackedFiles(project, worktree, [
      '.env.local',
      'config/*.json',
      'tracked.env',
      '**/.env.local'
    ])
    expect(report.copied).toEqual(['.env.local', 'config/db.local.json'])
    expect(fs.readFileSync(path.join(worktree, '.env.local'), 'utf8')).toBe('SECRET=1')
    expect(fs.existsSync(path.join(worktree, 'tracked.env'))).toBe(false)
    expect(fs.existsSync(path.join(worktree, 'config/app.json'))).toBe(false)
    expect(fs.existsSync(path.join(worktree, 'node_modules'))).toBe(false)
    expect(report.capped).toBe(false)
  })

  it('never overwrites a file the worktree already has', async () => {
    write(worktree, '.env.local', 'MINE=1')
    const report = await copyUntrackedFiles(project, worktree, ['.env.local'])
    expect(report.copied).toEqual([])
    expect(report.skippedExisting).toBe(1)
    expect(fs.readFileSync(path.join(worktree, '.env.local'), 'utf8')).toBe('MINE=1')
  })

  it('does not follow symlinks or patterns out of the project root', async () => {
    write(tmp, 'outside/secret.txt', 'outside')
    fs.symlinkSync(path.join(tmp, 'outside'), path.join(project, 'linked'))
    fs.symlinkSync(path.join(tmp, 'outside/secret.txt'), path.join(project, 'link.txt'))
    const report = await copyUntrackedFiles(project, worktree, [
      'linked/*',
      'linked',
      'link.txt',
      '../outside/secret.txt',
      path.join(tmp, 'outside/secret.txt')
    ])
    expect(report.copied).toEqual([])
    expect(fs.readdirSync(worktree)).toEqual([])
  })

  it('refuses a destination whose parent is a symlink in the worktree', async () => {
    fs.mkdirSync(path.join(tmp, 'elsewhere'))
    fs.symlinkSync(path.join(tmp, 'elsewhere'), path.join(worktree, 'config'))
    const report = await copyUntrackedFiles(project, worktree, ['config/db.local.json'])
    expect(report.copied).toEqual([])
    expect(report.failed).toBe(1)
    expect(fs.readdirSync(path.join(tmp, 'elsewhere'))).toEqual([])
  })

  it('reports when the caps are hit', async () => {
    write(project, 'a.local', 'aaaa')
    write(project, 'b.local', 'bbbb')
    write(project, 'c.local', 'cccc')
    const byCount = await copyUntrackedFiles(project, worktree, ['?.local'], {
      maxFiles: 2,
      maxTotalBytes: 1000,
      maxEntries: 1000
    })
    expect(byCount.copied).toEqual(['a.local', 'b.local'])
    expect(byCount.capped).toBe(true)

    const other = path.join(tmp, 'worktree2')
    fs.mkdirSync(other)
    const bySize = await copyUntrackedFiles(project, other, ['?.local'], {
      maxFiles: 10,
      maxTotalBytes: 5,
      maxEntries: 1000
    })
    expect(bySize.copied).toEqual(['a.local'])
    expect(bySize.capped).toBe(true)
  })
})
