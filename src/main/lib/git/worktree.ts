/**
 * Git worktree lifecycle for chats: each chat gets an isolated worktree
 * under userData/worktrees/<projectId>/<chatId> on a namespaced branch.
 */
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { simpleGit } from 'simple-git'

export interface WorktreeInfo {
  worktreePath: string
  branch: string
  baseBranch: string
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || 'chat'
}

export function worktreesRoot(): string {
  return path.join(app.getPath('userData'), 'worktrees')
}

export async function detectDefaultBranch(projectPath: string): Promise<string> {
  const git = simpleGit(projectPath)
  try {
    const ref = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    const m = ref.trim().match(/refs\/remotes\/origin\/(.+)$/)
    if (m) return m[1]
  } catch {
    // no origin/HEAD
  }
  try {
    const branch = await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])
    const name = branch.trim()
    if (name && name !== 'HEAD') return name
  } catch {
    // detached / unborn
  }
  return 'main'
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const out = await simpleGit(dir).raw(['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
}

async function uniqueBranch(projectPath: string, base: string): Promise<string> {
  const git = simpleGit(projectPath)
  let candidate = base
  for (let i = 2; i < 100; i++) {
    try {
      await git.raw(['rev-parse', '--verify', `refs/heads/${candidate}`])
      candidate = `${base}-${i}`
    } catch {
      return candidate
    }
  }
  return `${base}-${Date.now()}`
}

/** Optional per-repo worktree setup commands (mirrors 1code's format). */
async function readSetupCommands(projectPath: string): Promise<string[]> {
  for (const rel of ['.codezero/worktree.json', '.1code/worktree.json']) {
    try {
      const raw = await fs.readFile(path.join(projectPath, rel), 'utf8')
      const parsed = JSON.parse(raw) as { 'setup-worktree'?: string[] }
      if (Array.isArray(parsed['setup-worktree'])) return parsed['setup-worktree']
    } catch {
      // missing or invalid — skip
    }
  }
  return []
}

export async function createWorktree(
  projectId: string,
  projectPath: string,
  chatId: string,
  title: string,
  baseBranch: string
): Promise<WorktreeInfo> {
  const git = simpleGit(projectPath)
  const branch = await uniqueBranch(projectPath, `codezero/${slugify(title)}`)
  const worktreePath = path.join(worktreesRoot(), projectId, chatId)
  await fs.mkdir(path.dirname(worktreePath), { recursive: true })

  // Resolve the base ref; fall back to HEAD if the branch doesn't exist.
  let baseRef = baseBranch
  try {
    await git.raw(['rev-parse', '--verify', baseRef])
  } catch {
    baseRef = 'HEAD'
  }

  await git.raw(['worktree', 'add', '-b', branch, worktreePath, baseRef])

  // Run setup commands best-effort (npm install etc.).
  const commands = await readSetupCommands(projectPath)
  if (commands.length > 0) {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)
    for (const cmd of commands) {
      try {
        await execAsync(cmd, { cwd: worktreePath, timeout: 300_000 })
      } catch (err) {
        console.error(`[worktree] setup command failed: ${cmd}`, err)
      }
    }
  }

  return { worktreePath, branch, baseBranch }
}

export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
  branch?: string
): Promise<void> {
  const git = simpleGit(projectPath)
  if (existsSync(worktreePath)) {
    try {
      await git.raw(['worktree', 'remove', '--force', worktreePath])
    } catch (err) {
      console.error('[worktree] remove failed, forcing rm', err)
      await fs.rm(worktreePath, { recursive: true, force: true })
      await git.raw(['worktree', 'prune']).catch(() => {})
    }
  } else {
    await git.raw(['worktree', 'prune']).catch(() => {})
  }
  if (branch?.startsWith('codezero/')) {
    await git.raw(['branch', '-D', branch]).catch(() => {})
  }
}
