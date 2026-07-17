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

export async function writeMcpServers(
  servers: Record<string, McpServerConfig>,
  projectPath?: string
): Promise<void> {
  const file = mcpJsonPath(projectPath)
  const existing = await readMcpJson(projectPath)
  const next: McpJson = { ...existing, mcpServers: servers }
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(tmp, file)
}
