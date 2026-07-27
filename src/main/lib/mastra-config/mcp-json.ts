/**
 * Read/write ~/.mastracode/mcp.json (shared with the mastracode CLI).
 * Read-modify-write preserving unknown keys; atomic replace on write.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function mastraConfigDir(): string {
  return path.join(os.homedir(), '.mastracode')
}

export function mcpJsonPath(projectPath?: string): string {
  return projectPath
    ? path.join(projectPath, '.mastracode', 'mcp.json')
    : path.join(mastraConfigDir(), 'mcp.json')
}

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  [key: string]: unknown
}

export interface McpJson {
  mcpServers?: Record<string, McpServerConfig>
  [key: string]: unknown
}

export async function readMcpJson(projectPath?: string): Promise<McpJson> {
  try {
    const raw = await fs.readFile(mcpJsonPath(projectPath), 'utf8')
    return JSON.parse(raw) as McpJson
  } catch {
    return {}
  }
}

/** Serializes all mcp.json writes so concurrent writers can't lose each other's changes. */
let writeQueue: Promise<unknown> = Promise.resolve()

async function writeMcpJsonFile(next: McpJson, projectPath?: string): Promise<void> {
  const file = mcpJsonPath(projectPath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(tmp, file)
}

export function writeMcpServers(
  servers: Record<string, McpServerConfig>,
  projectPath?: string
): Promise<void> {
  const task = writeQueue.then(async () => {
    const existing = await readMcpJson(projectPath)
    await writeMcpJsonFile({ ...existing, mcpServers: servers }, projectPath)
  })
  writeQueue = task.catch(() => {})
  return task
}

/**
 * Queued read-modify-write of the mcpServers map (unknown top-level keys
 * preserved). Returns the servers map after the mutation.
 */
export function updateMcpServers(
  mutate: (servers: Record<string, McpServerConfig>) => void,
  projectPath?: string
): Promise<Record<string, McpServerConfig>> {
  const task = writeQueue.then(async () => {
    const existing = await readMcpJson(projectPath)
    const servers = existing.mcpServers ?? {}
    mutate(servers)
    await writeMcpJsonFile({ ...existing, mcpServers: servers }, projectPath)
    return servers
  })
  writeQueue = task.catch(() => {})
  return task
}
