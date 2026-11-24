/**
 * Git router for the Changes tab: status and diffs, stage/unstage/discard,
 * commit/push/pull, branches, merge into base, commit history, per-hunk
 * revert, and PR/MR operations through the gh / glab CLIs.
 */
import { z } from 'zod'
import {
  checkoutBranch,
  commit,
  commitFileDiff,
  commitFiles,
  createBranch,
  diffNameStatus,
  discardFiles,
  fileDiff,
  fileHunks,
  gitLog,
  gitStatus,
  listBranches,
  mergeBase,
  MergeConflictError,
  mergeIntoBase,
  pull,
  push,
  revertHunk,
  stageFiles,
  stashPush,
  unstageFiles
} from '../../git/ops'
import { forgeCreatePr, forgeInfo, forgeListPrs, forgePrForBranch } from '../../git/forge'
import { prCommentsForBranch } from '../../git/gh'
import { assertKnownRoot } from '../../known-roots'
import { publicProcedure, router } from '../trpc'

const cwdInput = z.object({ cwd: z.string() })

export const gitRouter = router({
  status: publicProcedure.input(cwdInput).query(({ input }) => gitStatus(input.cwd)),

  fileDiff: publicProcedure
    .input(cwdInput.extend({ path: z.string(), baseRef: z.string().optional() }))
    .query(({ input }) => fileDiff(input.cwd, input.path, input.baseRef)),

  /** Individually revertable hunks of the diff `fileDiff` shows (empty when none). */
  fileHunks: publicProcedure
    .input(cwdInput.extend({ path: z.string().min(1), baseRef: z.string().optional() }))
    .query(({ input }) => fileHunks(assertKnownRoot(input.cwd), input.path, input.baseRef)),

  /** Discard one hunk of a file's working-tree changes. */
  revertHunk: publicProcedure
    .input(
      cwdInput.extend({
        path: z.string().min(1),
        index: z.number().int().min(0),
        hash: z.string().min(1).max(64),
        baseRef: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      await revertHunk(assertKnownRoot(input.cwd), input.path, {
        index: input.index,
        hash: input.hash,
        baseRef: input.baseRef
      })
      return { ok: true }
    }),

  stage: publicProcedure
    .input(cwdInput.extend({ paths: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await stageFiles(input.cwd, input.paths)
      return { ok: true }
    }),

  unstage: publicProcedure
    .input(cwdInput.extend({ paths: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await unstageFiles(input.cwd, input.paths)
      return { ok: true }
    }),

  discard: publicProcedure
    .input(cwdInput.extend({ paths: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      await discardFiles(input.cwd, input.paths)
      return { ok: true }
    }),

  commit: publicProcedure
    .input(cwdInput.extend({ message: z.string().min(1), stageAll: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const sha = await commit(input.cwd, input.message, input.stageAll)
      return { sha }
    }),

  push: publicProcedure.input(cwdInput).mutation(async ({ input }) => {
    await push(input.cwd)
    return { ok: true }
  }),

  branches: publicProcedure.input(cwdInput).query(({ input }) => listBranches(input.cwd)),

  checkout: publicProcedure
    .input(cwdInput.extend({ branch: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await checkoutBranch(input.cwd, input.branch)
      return { ok: true }
    }),

  stash: publicProcedure
    .input(cwdInput.extend({ message: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await stashPush(input.cwd, input.message)
      return { ok: true }
    }),

  createBranch: publicProcedure
    .input(cwdInput.extend({ branch: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await createBranch(input.cwd, input.branch)
      return { ok: true }
    }),

  /** Repo host (GitHub/GitLab) + CLI availability for the working tree at cwd. */
  forgeInfo: publicProcedure.input(cwdInput).query(({ input }) => forgeInfo(input.cwd)),

  /** Open PRs/MRs for the repo at cwd (feeds the review picker). */
  listPrs: publicProcedure
    .input(cwdInput.extend({ limit: z.number().int().positive().max(50).default(20) }))
    .query(({ input }) => forgeListPrs(input.cwd, input.limit)),

  /** Open PR/MR for the branch checked out at cwd, or null (gates review follow-ups). */
  branchPr: publicProcedure.input(cwdInput).query(({ input }) => forgePrForBranch(input.cwd)),

  /**
   * PR conversation (comments + reviews) for the branch at cwd. GitHub-only —
   * returns null when the repo isn't GitHub, gh is missing, or there's no PR.
   */
  prComments: publicProcedure.input(cwdInput).query(async ({ input }) => {
    const info = await forgeInfo(input.cwd)
    if (info.provider !== 'github' || !info.cliAvailable) return null
    return prCommentsForBranch(input.cwd)
  }),

  createPr: publicProcedure
    .input(
      cwdInput.extend({
        title: z.string().min(1),
        body: z.string(),
        base: z.string().optional(),
        draft: z.boolean().optional()
      })
    )
    .mutation(({ input }) =>
      forgeCreatePr(input.cwd, {
        title: input.title,
        body: input.body,
        base: input.base,
        draft: input.draft
      })
    ),

  log: publicProcedure
    .input(cwdInput.extend({ limit: z.number().int().positive().max(200).default(50) }))
    .query(({ input }) => gitLog(input.cwd, input.limit)),

  /**
   * Pull from the upstream. A conflicted pull is aborted and reported as
   * `conflict` (a result, not an error) so the UI can offer conflict help.
   */
  pull: publicProcedure.input(cwdInput).mutation(async ({ input }) => {
    try {
      await pull(input.cwd)
      return { ok: true, conflict: null }
    } catch (err) {
      if (err instanceof MergeConflictError) {
        return { ok: false, conflict: { message: err.message, files: err.files } }
      }
      throw err
    }
  }),

  /**
   * Merge a worktree branch into the base branch at the project root. A
   * conflicted merge is aborted and reported as `conflict` with a null sha.
   */
  mergeIntoBase: publicProcedure
    .input(
      z.object({
        projectPath: z.string(),
        branch: z.string().min(1),
        baseBranch: z.string().min(1),
        squash: z.boolean().default(false),
        message: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { sha } = await mergeIntoBase(input.projectPath, input.branch, input.baseBranch, {
          squash: input.squash,
          message: input.message
        })
        return { sha, conflict: null }
      } catch (err) {
        if (err instanceof MergeConflictError) {
          return { sha: null, conflict: { message: err.message, files: err.files } }
        }
        throw err
      }
    }),

  /** Merge base of a compare ref and HEAD (null when unknown/unrelated). */
  mergeBase: publicProcedure
    .input(cwdInput.extend({ ref: z.string().min(1) }))
    .query(async ({ input }) => ({ sha: await mergeBase(input.cwd, input.ref) })),

  /** Worktree changes vs a base ref, for the compare-branch view. */
  diffAgainst: publicProcedure
    .input(cwdInput.extend({ baseRef: z.string().min(1) }))
    .query(({ input }) => diffNameStatus(input.cwd, input.baseRef)),

  commitFiles: publicProcedure
    .input(cwdInput.extend({ hash: z.string().min(1) }))
    .query(({ input }) => commitFiles(input.cwd, input.hash)),

  commitFileDiff: publicProcedure
    .input(cwdInput.extend({ hash: z.string().min(1), path: z.string().min(1) }))
    .query(({ input }) => commitFileDiff(input.cwd, input.hash, input.path))
})
