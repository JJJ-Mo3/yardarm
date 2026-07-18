import { z } from 'zod'
import {
  checkoutBranch,
  commit,
  createBranch,
  discardFiles,
  fileDiff,
  gitLog,
  gitStatus,
  listBranches,
  push,
  stageFiles,
  unstageFiles
} from '../../git/ops'
import { createPr, ghPath } from '../../git/gh'
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

  /** Whether the GitHub CLI is installed (enables the Create PR flow). */
  ghAvailable: publicProcedure.query(async () => ({ available: (await ghPath()) !== null })),

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
      createPr(input.cwd, {
        title: input.title,
        body: input.body,
        base: input.base,
        draft: input.draft
      })
    ),

  log: publicProcedure
    .input(cwdInput.extend({ limit: z.number().int().positive().max(200).default(50) }))
    .query(({ input }) => gitLog(input.cwd, input.limit))
})
