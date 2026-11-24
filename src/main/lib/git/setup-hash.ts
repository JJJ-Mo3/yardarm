/**
 * Stable fingerprint of a project's worktree setup commands. The commands
 * live in a repo file (.yardarm/worktree.json) that a clone or an agent edit
 * can change, so they only run once the user has approved this exact list —
 * approval is stored as this hash and any edit yields a different one.
 */
import { createHash } from 'node:crypto'

export function setupCommandsHash(commands: string[]): string {
  return createHash('sha256').update(JSON.stringify(commands)).digest('hex')
}
