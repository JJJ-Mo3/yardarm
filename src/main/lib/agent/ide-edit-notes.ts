/**
 * Helpers for tracking files the user edited through the in-app IDE so the
 * agent can be told about them. mastracode has no file-freshness tracking of
 * its own, so without this the agent would keep trusting stale reads of files
 * the user changed under it. Pending edits are stored per subchat in the app
 * DB (`subchats.pending_ide_edits`, a JSON array of relative paths) so they
 * survive app restarts; every subchat whose working directory matches the
 * save root is a recipient. They are drained either onto the active run as a
 * system-reminder signal (when the agent is running — the host's live
 * displayState is the authority on when that is safe) or into a one-shot
 * `<system-reminder>` suffix on the next model-bound prompt (when idle —
 * a note must never start a run of its own). Held/failed mid-run deliveries
 * are re-added and retried when the blocking approval/suspension resolves,
 * so a drained note is never lost.
 *
 * These helpers are pure JSON-column transforms; the session manager owns
 * the DB reads/writes.
 */

/** Add one path to a JSON-array column value (deduped); returns the new JSON. */
export function addIdeEditPath(json: string | null, path: string): string {
  const paths = parseIdeEditPaths(json)
  if (!paths.includes(path)) paths.push(path)
  return JSON.stringify(paths)
}

/** Parse a JSON-array column value into sorted paths; [] on null/garbage. */
export function parseIdeEditPaths(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === 'string').sort()
  } catch {
    return []
  }
}

/** Note text for the agent; '' when there is nothing to report. */
export function formatIdeEditNote(paths: string[]): string {
  if (paths.length === 0) return ''
  const list = paths.map((p) => `\`${p}\``).join(', ')
  return (
    `The user manually edited the following file(s) in the Yardarm IDE: ${list}. ` +
    `Your earlier reads of these files are stale — re-read them before relying on ` +
    `or modifying them.`
  )
}
