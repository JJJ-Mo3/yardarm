/**
 * Read/write database.json (project .mastracode/database.json or global
 * ~/.mastracode/database.json). Holds the memory resourceId; unknown keys
 * are preserved on write.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { queuedForFile, writeJsonAtomic } from './atomic-json'
import { mastraConfigDir } from './mcp-json'
import { readJsonForUpdate } from './settings-json'

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
  await queuedForFile(file, async () => {
    const config = await readJsonForUpdate<DatabaseJson>(file)
    if (resourceId === null) delete config.resourceId
    else config.resourceId = resourceId
    await writeJsonAtomic(file, config, 0o600)
  })
}
