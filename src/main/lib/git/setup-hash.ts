/**
 * Stable fingerprint of a project's worktree lifecycle config: setup
 * commands, copy-file patterns and teardown commands. They live in a repo
 * file (.yardarm/worktree.json) that a clone or an agent edit can change, so
 * nothing runs or is copied until the user has approved this exact content —
 * approval is stored as this hash and any edit yields a different one.
 */
import { createHash } from 'node:crypto'
import type { WorktreeConfig } from './worktree-config'

export function setupCommandsHash(commands: string[]): string {
  return createHash('sha256').update(JSON.stringify(commands)).digest('hex')
}

/**
 * One hash covering all three lists, so a single approval covers them. With
 * no copy patterns and no teardown commands it equals setupCommandsHash of
 * the setup commands, which keeps approvals stored before those lists existed
 * valid. Otherwise the input is a JSON object, which can never serialize to
 * the same text as the bare array of the legacy form.
 */
export function worktreeConfigHash(config: WorktreeConfig): string {
  if (config.copyFiles.length === 0 && config.teardown.length === 0) {
    return setupCommandsHash(config.setup)
  }
  const input = JSON.stringify({
    setup: config.setup,
    copyFiles: config.copyFiles,
    teardown: config.teardown
  })
  return createHash('sha256').update(input).digest('hex')
}
