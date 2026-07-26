/**
 * Ephemeral compare-against ref for the Changes view, keyed by the view's
 * cwd (one per chat worktree). When set, the Changes pane shows read-only
 * diffs against the merge-base with this ref instead of working-tree status.
 */
import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

export const compareRefAtomFamily = atomFamily((_cwd: string) => atom<string | null>(null))
