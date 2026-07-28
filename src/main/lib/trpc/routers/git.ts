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
  gitLog,
  gitStatus,
  listBranches,
  mergeBase,
  mergeIntoBase,
  pull,
  push,
  stageFiles,
  unstageFiles
} from '../../git/ops'
import { forgeCreatePr, forgeInfo, forgeListPrs, forgePrForBranch } from '../../git/forge'
import { publicProcedure, router } from '../trpc'

const cwdInput = z.object({ cwd: z.string() })

export const gitRouter = router({
  status: publicProcedure.input(cwdInput).query(({ input }) => gitStatus(input.cwd)),

  fileDiff: publicProcedure
    .input(cwdInput.extend({ path: z.string(), baseRef: z.string().optional() }))
    .query(({ input }) => fileDiff(input.cwd, input.path, input.baseRef)),

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

  pull: publicProcedure.input(cwdInput).mutation(async ({ input }) => {
    await pull(input.cwd)
    return { ok: true }
  }),

  /** Merge a worktree branch into the base branch at the project root. */
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
    .mutation(({ input }) =>
      mergeIntoBase(input.projectPath, input.branch, input.baseBranch, {
        squash: input.squash,
        message: input.message
      })
    ),

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
