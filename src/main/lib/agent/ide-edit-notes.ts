/**
 * Tracks files the user edited through the in-app IDE so the agent can be
 * told about them. mastracode has no file-freshness tracking of its own, so
 * without this the agent would keep trusting stale reads of files the user
 * changed under it. Edits are recorded per subchat (every subchat of a chat
 * shares the worktree) and drained into a one-shot `<system-reminder>` suffix
 * on the next model-bound prompt — never sent immediately, since any send
 * starts an agent run.
 *
 * Deliberately in-memory: notes are lost on app restart and subchats created
 * after an edit aren't notified. Harmless — worst case the agent re-reads.
 */
export class IdeEditTracker {
  private edits = new Map<string, Set<string>>() // subchatId → relative paths

  /** Record one edited path for each of the given subchats (deduped). */
  add(subchatIds: string[], path: string): void {
    for (const id of subchatIds) {
      let set = this.edits.get(id)
      if (!set) {
        set = new Set()
        this.edits.set(id, set)
      }
      set.add(path)
    }
  }

  /** Take (and clear) the edited paths for a subchat, sorted for stable output. */
  drain(subchatId: string): string[] {
    const set = this.edits.get(subchatId)
    if (!set || set.size === 0) return []
    this.edits.delete(subchatId)
    return [...set].sort()
  }

  /** Forget a subchat entirely (chat/subchat deletion). */
  clear(subchatId: string): void {
    this.edits.delete(subchatId)
  }
}

/** Note text for the agent; '' when there is nothing to report. */
export function formatIdeEditNote(paths: string[]): string {
  if (paths.length === 0) return ''
  const list = paths.map((p) => `\`${p}\``).join(', ')
  return (
    `The user manually edited the following file(s) in the Yardarm IDE since your last ` +
    `message: ${list}. Their contents on disk may differ from any earlier reads — re-read ` +
    `them before relying on or modifying them.`
  )
}
