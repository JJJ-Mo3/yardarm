/**
 * List/read/write custom .md slash commands under .mastracode/commands
 * (project scope) or ~/.mastracode/commands (global scope).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { mastraConfigDir } from './mcp-json'

export interface CommandFileInfo {
  /** Command name as typed after "/": relative path minus .md, "/" → ":". */
  name: string
  /** Path relative to the commands dir, e.g. "release/notes.md". */
  relPath: string
  /** Absolute file path. */
  path: string
  description?: string
}

export function commandsDir(projectPath?: string): string {
  return projectPath
    ? path.join(projectPath, '.mastracode', 'commands')
    : path.join(mastraConfigDir(), 'commands')
}

/** Resolve relPath inside the commands dir, rejecting traversal. */
function resolveCommandFile(projectPath: string | undefined, relPath: string): string {
  const dir = commandsDir(projectPath)
  const abs = path.resolve(dir, relPath)
  if (abs !== dir && !abs.startsWith(dir + path.sep)) {
    throw new Error(`Invalid command path: ${relPath}`)
  }
  if (!abs.endsWith('.md')) throw new Error('Command files must end in .md')
  return abs
}

function parseDescription(content: string): string | undefined {
  // Frontmatter description: --- ... description: xyz ... ---
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const m = fm?.[1].match(/^description:\s*(.+)$/m)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined
}

export async function listCommandFiles(projectPath?: string): Promise<CommandFileInfo[]> {
  const dir = commandsDir(projectPath)
  const out: CommandFileInfo[] = []
  async function walk(sub: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(path.join(dir, sub), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = sub ? path.join(sub, entry.name) : entry.name
      if (entry.isDirectory()) {
        await walk(rel)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        let description: string | undefined
        try {
          description = parseDescription(await fs.readFile(path.join(dir, rel), 'utf8'))
        } catch {
          // unreadable file — still list it
        }
        out.push({
          name: rel.slice(0, -'.md'.length).split(path.sep).join(':'),
          relPath: rel,
          path: path.join(dir, rel),
          description
        })
      }
    }
  }
  await walk('')
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readCommandFile(
  projectPath: string | undefined,
  relPath: string
): Promise<string> {
  return fs.readFile(resolveCommandFile(projectPath, relPath), 'utf8')
}

export async function writeCommandFile(
  projectPath: string | undefined,
  relPath: string,
  content: string
): Promise<void> {
  const file = resolveCommandFile(projectPath, relPath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, content, { mode: 0o644 })
  await fs.rename(tmp, file)
}

const COMMAND_TEMPLATE = `---
description: What this command does
---

Prompt sent to the agent. Use $ARGUMENTS for everything after the command
name, or $1..$9 for positional args. Lines starting with ! run as shell
commands and their output is inlined.
`

/** Create a new command file; fails if it already exists. */
export async function createCommandFile(
  projectPath: string | undefined,
  name: string
): Promise<CommandFileInfo> {
  const relPath = `${name.replace(/:/g, path.sep)}.md`
  const file = resolveCommandFile(projectPath, relPath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, COMMAND_TEMPLATE, { mode: 0o644, flag: 'wx' })
  return { name, relPath, path: file }
}

export async function deleteCommandFile(
  projectPath: string | undefined,
  relPath: string
): Promise<void> {
  await fs.rm(resolveCommandFile(projectPath, relPath))
}
