/**
 * Repo-wiki router: serves agent-generated wiki pages stored per project
 * under <userData>/wiki/<projectId>/, kicks off generation (which runs as a
 * marked agent task in the project's dedicated behind-the-scenes wiki chat —
 * see wiki-generate.ts), reports generation status, and reports staleness
 * (commits behind) vs the project repo's HEAD.
 */
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { deleteWiki, listPages, readMeta, readPage, wikiDir } from '../../wiki/wiki-fs'
import { startWikiGeneration, wikiGenerationStatus } from '../../wiki/wiki-generate'
import { publicProcedure, router } from '../trpc'

export interface WikiMetaResult {
  sha: string | null
  generatedAt: number
  /** Commits on the project HEAD since generation; null when unknown. */
  behind: number | null
}

function storeDir(projectId: string): string {
  return wikiDir(app.getPath('userData'), projectId)
}

export const wikiRouter = router({
  pages: publicProcedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => {
    return listPages(storeDir(input.projectId))
  }),

  page: publicProcedure
    .input(z.object({ projectId: z.string(), name: z.string() }))
    .query(async ({ input }) => {
      return { content: await readPage(storeDir(input.projectId), input.name) }
    }),

  meta: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }): Promise<WikiMetaResult | null> => {
      const meta = await readMeta(storeDir(input.projectId))
      if (!meta) return null
      let behind: number | null = null
      if (meta.sha) {
        const db = getDb()
        const project = db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, input.projectId))
          .get()
        if (project && existsSync(project.path)) {
          try {
            const out = await simpleGit(project.path).raw([
              'rev-list',
              '--count',
              `${meta.sha}..HEAD`
            ])
            const n = parseInt(out.trim(), 10)
            if (!Number.isNaN(n)) behind = n
          } catch {
            // unknown sha (rebased/gc'd) — staleness unknown
          }
        }
      }
      return { sha: meta.sha, generatedAt: meta.generatedAt, behind }
    }),

  /** Start a generation run in the project's dedicated wiki chat (never queues). */
  generate: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input }) => {
      return startWikiGeneration(input.projectId)
    }),

  /** Live generation status + opportunistic recovery of leftover staging. */
  status: publicProcedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => {
    return wikiGenerationStatus(input.projectId)
  }),

  remove: publicProcedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => {
    await deleteWiki(storeDir(input.projectId))
    return { ok: true }
  })
})
