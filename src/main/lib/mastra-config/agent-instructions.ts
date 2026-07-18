/**
 * Read/write a project's .mastracode/agent-instructions.md and detect
 * legacy instruction files (AGENTS.md / CLAUDE.md) the SDK also honors.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const LEGACY_FILES = ['AGENTS.md', 'CLAUDE.md']

export interface InstructionsInfo {
  path: string
  /** null when the file doesn't exist yet. */
  content: string | null
  /** Legacy instruction files present at the project root. */
  legacyFiles: string[]
}

export function instructionsPath(projectPath: string): string {
  return path.join(projectPath, '.mastracode', 'agent-instructions.md')
}

export async function readInstructions(projectPath: string): Promise<InstructionsInfo> {
  const file = instructionsPath(projectPath)
  let content: string | null = null
  try {
    content = await fs.readFile(file, 'utf8')
  } catch {
    // not created yet
  }
  const legacyFiles: string[] = []
  for (const name of LEGACY_FILES) {
    try {
      await fs.access(path.join(projectPath, name))
      legacyFiles.push(name)
    } catch {
      // absent
    }
  }
  return { path: file, content, legacyFiles }
}

export async function writeInstructions(projectPath: string, content: string): Promise<void> {
  const file = instructionsPath(projectPath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, content, { mode: 0o644 })
  await fs.rename(tmp, file)
}
