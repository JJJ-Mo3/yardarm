/**
 * Prune eligibility for checkpoint keep-alive refs (refs/yardarm/checkpoints).
 * A pinned stash sha may only be collected when nothing still references it:
 * neither a message rollback anchor (messages.checkpoint_ref JSON) nor a
 * named checkpoint row. Pure so it can be unit-tested.
 */
import { checkpointStashSha } from './ops'

/** Stash shas that must be kept, from message refs + named checkpoint rows. */
export function collectKeepShas(
  messageCheckpointRefs: Array<string | null>,
  namedStashShas: Array<string | null>
): Set<string> {
  const keep = new Set<string>()
  for (const ref of messageCheckpointRefs) {
    const sha = ref ? checkpointStashSha(ref) : null
    if (sha) keep.add(sha)
  }
  for (const sha of namedStashShas) {
    if (sha) keep.add(sha)
  }
  return keep
}

/** Pinned refs safe to delete: everything not in the keep set. */
export function pruneEligibleShas(pinnedShas: string[], keep: Set<string>): string[] {
  return pinnedShas.filter((sha) => !keep.has(sha))
}
