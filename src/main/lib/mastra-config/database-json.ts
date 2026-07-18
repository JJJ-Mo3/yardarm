/**
 * Read/write database.json (project .mastracode/database.json or global
 * ~/.mastracode/database.json). Holds the memory resourceId; unknown keys
 * are preserved on write.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { mastraConfigDir } from './mcp-json'

export interface DatabaseJson {
  resourceId?: string
  [key: string]: unknown
}

export function databaseJsonPath(projectPath?: string): string {
  return projectPath
    ? path.join(projectPath, '.mastracode', 'database.json')
    : path.join(mastraConfigDir(), 'database.json')
}

export async function readDatabaseJson(
  projectPath?: string
): Promise<{ path: string; config: DatabaseJson }> {
  const file = databaseJsonPath(projectPath)
  try {
    const raw = await fs.readFile(file, 'utf8')
    return { path: file, config: JSON.parse(raw) as DatabaseJson }
  } catch {
    return { path: file, config: {} }
  }
}

/** Set (or remove, with null) the resourceId; preserves other keys. */
export async function writeResourceId(
  resourceId: string | null,
  projectPath?: string
): Promise<void> {
  const file = databaseJsonPath(projectPath)
  const { config } = await readDatabaseJson(projectPath)
  if (resourceId === null) delete config.resourceId
  else config.resourceId = resourceId
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(tmp, file)
}
