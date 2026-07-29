/**
 * List/read/write custom subagent definitions under .mastracode/agents
 * (project scope) or ~/.mastracode/agents (global scope). Each agent is one
 * .md file: line-based `key: value` frontmatter between --- fences (name,
 * description, model, maxSteps, forked) with the body as the subagent's
 * instructions. Definitions are loaded at host boot and passed to the SDK,
 * which exposes them to the main agent through the `subagent` tool.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { mastraConfigDir } from './mcp-json'
import type { SubagentDefinition } from '../../../shared/ipc-types'

/**
 * Ids the SDK/settings may claim for built-in roles (settings.json
 * models.subagentModels keys today; future SDKs may ship defaults).
 */
export const RESERVED_SUBAGENT_IDS = ['explore', 'plan', 'execute', 'general'] as const

const ID_RE = /^[\w-]+$/

/**
 * Per-agent instructions cap. Definitions travel to the host inside the
 * YARDARM_BOOT env var, so unbounded bodies could blow the env size limit.
 */
const MAX_INSTRUCTIONS_CHARS = 32_000

/** Structured contents of one agent .md file. */
export interface AgentFileData {
  name: string
  description: string
  instructions: string
  model?: string
  maxSteps?: number
  forked?: boolean
}

export interface AgentFileInfo {
  id: string
  path: string
  description?: string
}

export function agentsDir(projectPath?: string): string {
  return projectPath
    ? path.join(projectPath, '.mastracode', 'agents')
    : path.join(mastraConfigDir(), 'agents')
}

function validateId(id: string): void {
  if (!ID_RE.test(id)) {
    throw new Error(`Invalid agent id: ${id} (use letters, digits, _ or -)`)
  }
  if ((RESERVED_SUBAGENT_IDS as readonly string[]).includes(id)) {
    throw new Error(`"${id}" is a reserved subagent id — pick another name`)
  }
}

/** Resolve an agent id to its file inside the agents dir, rejecting traversal. */
function resolveAgentFile(projectPath: string | undefined, id: string): string {
  validateId(id)
  const dir = agentsDir(projectPath)
  const abs = path.resolve(dir, `${id}.md`)
  if (!abs.startsWith(dir + path.sep)) throw new Error(`Invalid agent path: ${id}`)
  return abs
}

/** Parse one agent .md file. Returns null when required fields are missing. */
export function parseAgentMarkdown(id: string, raw: string): AgentFileData | null {
  let body = raw
  const fields: Record<string, string> = {}
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (fm) {
    body = raw.slice(fm[0].length)
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
      if (m) fields[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  if (!fields.description) return null
  const maxSteps = Number.parseInt(fields.maxSteps ?? '', 10)
  return {
    name: fields.name || id,
    description: fields.description,
    instructions: body.trim(),
    model: fields.model || undefined,
    maxSteps: Number.isInteger(maxSteps) && maxSteps > 0 ? maxSteps : undefined,
    forked: fields.forked === 'true' ? true : undefined
  }
}

export function serializeAgentMarkdown(data: AgentFileData): string {
  const lines = ['---', `name: ${data.name}`, `description: ${data.description}`]
  if (data.model) lines.push(`model: ${data.model}`)
  if (data.maxSteps) lines.push(`maxSteps: ${data.maxSteps}`)
  if (data.forked) lines.push('forked: true')
  lines.push('---', '', data.instructions.trim(), '')
  return lines.join('\n')
}

function toDefinition(id: string, data: AgentFileData): SubagentDefinition {
  return {
    id,
    name: data.name,
    description: data.description,
    instructions: data.instructions.slice(0, MAX_INSTRUCTIONS_CHARS),
    defaultModelId: data.model,
    maxSteps: data.maxSteps,
    forked: data.forked
  }
}

/**
 * Merge global and project definitions: project wins on id collisions;
 * reserved/invalid ids are dropped and reported in `skipped`.
 */
export function mergeSubagentDefinitions(
  global: SubagentDefinition[],
  project: SubagentDefinition[]
): { defs: SubagentDefinition[]; skipped: string[] } {
  const byId = new Map<string, SubagentDefinition>()
  const skipped: string[] = []
  for (const def of [...global, ...project]) {
    if (!ID_RE.test(def.id) || (RESERVED_SUBAGENT_IDS as readonly string[]).includes(def.id)) {
      skipped.push(def.id)
      continue
    }
    byId.set(def.id, def) // later (project) entries overwrite global ones
  }
  return { defs: [...byId.values()], skipped }
}

async function loadScope(projectPath?: string): Promise<SubagentDefinition[]> {
  const dir = agentsDir(projectPath)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const defs: SubagentDefinition[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const id = entry.name.slice(0, -'.md'.length)
    try {
      const data = parseAgentMarkdown(id, await fs.readFile(path.join(dir, entry.name), 'utf8'))
      if (!data) {
        console.warn(`[agents] ${path.join(dir, entry.name)}: missing description — skipped`)
        continue
      }
      defs.push(toDefinition(id, data))
    } catch {
      // unreadable file — skip
    }
  }
  return defs.sort((a, b) => a.id.localeCompare(b.id))
}

/** Global + project definitions for a host boot. Never throws. */
export async function loadSubagentDefinitions(projectPath?: string): Promise<SubagentDefinition[]> {
  const [global, project] = await Promise.all([
    loadScope(undefined),
    projectPath ? loadScope(projectPath) : Promise.resolve([])
  ])
  const { defs, skipped } = mergeSubagentDefinitions(global, project)
  if (skipped.length > 0) {
    console.warn(`[agents] skipped reserved/invalid subagent ids: ${skipped.join(', ')}`)
  }
  return defs
}

export async function listAgentFiles(projectPath?: string): Promise<AgentFileInfo[]> {
  const dir = agentsDir(projectPath)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: AgentFileInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const id = entry.name.slice(0, -'.md'.length)
    let description: string | undefined
    try {
      description = parseAgentMarkdown(
        id,
        await fs.readFile(path.join(dir, entry.name), 'utf8')
      )?.description
    } catch {
      // unreadable file — still list it
    }
    out.push({ id, path: path.join(dir, entry.name), description })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export async function readAgentFile(
  projectPath: string | undefined,
  id: string
): Promise<{ content: string; parsed: AgentFileData | null }> {
  const content = await fs.readFile(resolveAgentFile(projectPath, id), 'utf8')
  return { content, parsed: parseAgentMarkdown(id, content) }
}

export async function writeAgentFile(
  projectPath: string | undefined,
  id: string,
  data: AgentFileData
): Promise<void> {
  const file = resolveAgentFile(projectPath, id)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, serializeAgentMarkdown(data), { mode: 0o644 })
  await fs.rename(tmp, file)
}

const AGENT_TEMPLATE: AgentFileData = {
  name: '',
  description: 'What tasks this subagent should be delegated',
  instructions: 'You are a focused subagent. Complete the delegated task and report back concisely.'
}

/** Create a new agent file; fails if it already exists. */
export async function createAgentFile(
  projectPath: string | undefined,
  id: string
): Promise<AgentFileInfo> {
  const file = resolveAgentFile(projectPath, id)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const content = serializeAgentMarkdown({ ...AGENT_TEMPLATE, name: id })
  await fs.writeFile(file, content, { mode: 0o644, flag: 'wx' })
  return { id, path: file, description: AGENT_TEMPLATE.description }
}

/**
 * Write an agent file only if it doesn't exist yet (exclusive create, so a
 * user's customized file is never overwritten). Returns false when skipped.
 */
export async function writeAgentFileIfAbsent(
  projectPath: string | undefined,
  id: string,
  data: AgentFileData
): Promise<boolean> {
  const file = resolveAgentFile(projectPath, id)
  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    await fs.writeFile(file, serializeAgentMarkdown(data), { mode: 0o644, flag: 'wx' })
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
}

export async function deleteAgentFile(projectPath: string | undefined, id: string): Promise<void> {
  await fs.rm(resolveAgentFile(projectPath, id))
}
