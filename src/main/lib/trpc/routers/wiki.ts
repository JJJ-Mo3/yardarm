/**
 * Repo-wiki router: serves agent-generated wiki pages stored per project
 * under <userData>/wiki/<projectId>/, prepares a generation run (registers
 * .yardarm-wiki/ in .git/info/exclude + writes staging meta in the chat
 * worktree), collects finished staging into the store, and reports
 * staleness (commits behind) vs the project repo's HEAD.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import {
  collectStaging,
  deleteWiki,
  ensureExcludeLine,
  listPages,
  readMeta,
  readPage,
  wikiDir,
  WIKI_STAGING_DIR,
  writeStagingMeta
} from '../../wiki/wiki-fs'
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

function chatContext(chatId: string): { cwd: string; projectId: string } {
  const db = getDb()
  const chat = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
  if (!chat) throw new Error('Chat not found')
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, chat.projectId))
    .get()
  if (!project) throw new Error('Project not found')
  const cwd = chat.worktreePath ?? project.path
  if (!existsSync(cwd)) throw new Error(`Folder no longer exists: ${cwd}`)
  return { cwd, projectId: project.id }
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

  /** Pre-generation setup: keep .yardarm-wiki/ out of git + write staging meta. */
  prepare: publicProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ input }) => {
    const { cwd, projectId } = chatContext(input.chatId)
    const git = simpleGit(cwd)
    let sha: string | null = null
    try {
      sha = (await git.revparse(['HEAD'])).trim() || null
    } catch {
      // repo without commits
    }
    try {
      // info/exclude resolves to the shared common dir for worktrees; never
      // the user's .gitignore. `git add -A` and checkpoint capture respect it.
      const rel = (await git.raw(['rev-parse', '--git-path', 'info/exclude'])).trim()
      await ensureExcludeLine(path.resolve(cwd, rel), `${WIKI_STAGING_DIR}/`)
    } catch {
      // not a git repo — exclusion is best-effort
    }
    await writeStagingMeta(cwd, { projectId, sha })
    return { ok: true }
  }),

  /** Move finished staging pages into the store (retry-safe no-op without any). */
  collect: publicProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ input }) => {
    const { cwd, projectId } = chatContext(input.chatId)
    const collected = await collectStaging(cwd, storeDir(projectId))
    return { collected }
  }),

  remove: publicProcedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => {
    await deleteWiki(storeDir(input.projectId))
    return { ok: true }
  })
})
