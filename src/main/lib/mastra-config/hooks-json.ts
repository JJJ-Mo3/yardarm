/**
 * Read/write hooks.json (global ~/.mastracode/hooks.json or a project's
 * .mastracode/hooks.json — the SDK merges global first, project appended).
 * Validates event names and hook shapes; atomic replace on write.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { mastraConfigDir } from './mcp-json'

/** Mirror of the SDK's HookEventName union (hooks/types). */
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Notification',
  'AgentStart',
  'AgentEnd',
  'PermissionRequest',
  'PermissionResult',
  'Interrupt',
  'SubagentStart',
  'SubagentEnd'
] as const

export interface HookDefinitionJson {
  type: 'command'
  command: string
  matcher?: { tool_name?: string }
  timeout?: number
  description?: string
  [key: string]: unknown
}

export type HooksJson = Partial<Record<string, HookDefinitionJson[]>>

export function hooksJsonPath(projectPath?: string): string {
  return projectPath
    ? path.join(projectPath, '.mastracode', 'hooks.json')
    : path.join(mastraConfigDir(), 'hooks.json')
}

export async function readHooksJson(
  projectPath?: string
): Promise<{ path: string; config: HooksJson }> {
  const file = hooksJsonPath(projectPath)
  try {
    const raw = await fs.readFile(file, 'utf8')
    return { path: file, config: JSON.parse(raw) as HooksJson }
  } catch {
    return { path: file, config: {} }
  }
}

/** Throws with a human-readable message when the config is malformed. */
export function validateHooksJson(config: unknown): asserts config is HooksJson {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('hooks.json must be a JSON object keyed by event name')
  }
  const events = new Set<string>(HOOK_EVENTS)
  for (const [event, hooks] of Object.entries(config)) {
    if (!events.has(event)) {
      throw new Error(`Unknown hook event "${event}". Valid: ${HOOK_EVENTS.join(', ')}`)
    }
    if (!Array.isArray(hooks)) throw new Error(`"${event}" must be an array of hooks`)
    for (const hook of hooks) {
      if (hook === null || typeof hook !== 'object') {
        throw new Error(`"${event}" contains a non-object hook entry`)
      }
      const h = hook as Record<string, unknown>
      if (h.type !== 'command') {
        throw new Error(`"${event}" hook has type "${String(h.type)}"; only "command" is supported`)
      }
      if (typeof h.command !== 'string' || !h.command.trim()) {
        throw new Error(`"${event}" hook is missing a "command" string`)
      }
    }
  }
}

export async function writeHooksJson(config: unknown, projectPath?: string): Promise<void> {
  validateHooksJson(config)
  const file = hooksJsonPath(projectPath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(tmp, file)
}
