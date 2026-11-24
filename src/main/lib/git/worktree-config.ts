/**
 * Shape of .yardarm/worktree.json — the per-repo worktree lifecycle config:
 * setup commands run in a new worktree, glob patterns of untracked files
 * copied into it, and teardown commands run right before it is removed. Pure
 * parsing/normalizing only (no fs, no Electron) so it can be unit-tested; the
 * file lives in the repo, so every list is untrusted until the user approves
 * the exact contents (see setup-hash.ts).
 */

export const SETUP_KEY = 'setup-worktree'
export const COPY_KEY = 'copy-files'
export const TEARDOWN_KEY = 'teardown-worktree'

export interface WorktreeConfig {
  /** Shell commands run in every new worktree ("setup-worktree"). */
  setup: string[]
  /** Glob patterns, relative to the project root, of untracked files to copy ("copy-files"). */
  copyFiles: string[]
  /** Shell commands run in a worktree right before it is removed ("teardown-worktree"). */
  teardown: string[]
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/** Read the three lists out of a parsed worktree.json; anything malformed reads as empty. */
export function parseWorktreeConfig(parsed: unknown): WorktreeConfig {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { setup: [], copyFiles: [], teardown: [] }
  }
  const obj = parsed as Record<string, unknown>
  return {
    setup: stringList(obj[SETUP_KEY]),
    copyFiles: stringList(obj[COPY_KEY]),
    teardown: stringList(obj[TEARDOWN_KEY])
  }
}

/** True when the config asks for nothing (no approval needed, nothing to run or copy). */
export function isWorktreeConfigEmpty(config: WorktreeConfig): boolean {
  return config.setup.length === 0 && config.copyFiles.length === 0 && config.teardown.length === 0
}

/** Trim entries and drop blank lines (editor input: one entry per line). */
export function cleanList(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0)
}

/**
 * Write the lists into an existing worktree.json object, preserving unknown
 * keys. Empty lists remove their key. Returns the same (mutated) object.
 */
export function applyWorktreeConfig(
  target: Record<string, unknown>,
  config: WorktreeConfig
): Record<string, unknown> {
  const entries: Array<[string, string[]]> = [
    [SETUP_KEY, config.setup],
    [COPY_KEY, config.copyFiles],
    [TEARDOWN_KEY, config.teardown]
  ]
  for (const [key, list] of entries) {
    if (list.length > 0) target[key] = list
    else delete target[key]
  }
  return target
}
