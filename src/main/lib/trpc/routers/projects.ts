import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { checkpointStashSha, deleteCheckpointRefs } from '../../git/ops'
import {
  detectDefaultBranch,
  ensureBaseCommit,
  isGitRepo,
  removeWorktree
} from '../../git/worktree'
import { ptyManager } from '../../terminal/pty-manager'
import { publicProcedure, router } from '../trpc'

async function pickDirectory(title: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opts = {
    title,
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
}

/** Insert a project row, or return the existing one for this path. */
async function insertProject(projectPath: string): Promise<typeof schema.projects.$inferSelect> {
  const db = getDb()
  const existing = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.path, projectPath))
    .get()
  if (existing) return existing

  const project = {
    id: randomUUID(),
    name: path.basename(projectPath),
    path: projectPath,
    defaultBranch: await detectDefaultBranch(projectPath),
    settings: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  db.insert(schema.projects).values(project).run()
  return project
}

export const projectsRouter = router({
  list: publicProcedure.query(() => {
    return getDb().select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all()
  }),

  /** Open a native folder picker; returns the chosen path or null if canceled. */
  pickFolder: publicProcedure
    .input(z.object({ title: z.string().optional() }).optional())
    .mutation(({ input }) => pickDirectory(input?.title ?? 'Select folder')),

  /**
   * Add a folder as a project. Non-git folders are reported back (not thrown)
   * so the UI can offer to initialize a repository; pass init=true to do so.
   */
  add: publicProcedure
    .input(z.object({ path: z.string().min(1), init: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      if (!(await isGitRepo(input.path))) {
        if (!input.init) return { ok: false as const, reason: 'not-git' as const }
        await simpleGit(input.path).init()
        // A repo with an unborn HEAD can't host worktrees; bootstrap it.
        await ensureBaseCommit(input.path)
      }
      return { ok: true as const, project: await insertProject(input.path) }
    }),

  /** Clone a remote repository into parentDir/<repo-name> and add it as a project. */
  cloneFromUrl: publicProcedure
    .input(z.object({ url: z.string().min(1), parentDir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const url = input.url.trim()
      // Restrict to real transport prefixes so the value can never be
      // interpreted as a git flag, and pathological inputs fail fast.
      if (!/^(https?:\/\/|ssh:\/\/|git@)/.test(url)) {
        throw new Error('Enter an https://, ssh://, or git@ repository URL')
      }
      const name = url
        .replace(/\/+$/, '')
        .split(/[/:]/)
        .pop()
        ?.replace(/\.git$/, '')
      if (!name) throw new Error('Could not determine the repository name from that URL')

      const target = path.join(input.parentDir, name)
      if (existsSync(target)) throw new Error(`Destination already exists: ${target}`)

      await simpleGit().clone(url, target)
      return insertProject(target)
    }),

  /**
   * Remove a project and everything attached to it: agent hosts, terminals,
   * chat worktrees, and pinned checkpoint refs. DB rows cascade via FKs.
   * Filesystem/git cleanup is best-effort — the folder may already be gone.
   */
  remove: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const db = getDb()
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, input.id)).get()
    if (!project) return { ok: true }

    const chats = db.select().from(schema.chats).where(eq(schema.chats.projectId, project.id)).all()
    const subchats =
      chats.length > 0
        ? db
            .select()
            .from(schema.subchats)
            .where(
              inArray(
                schema.subchats.chatId,
                chats.map((c) => c.id)
              )
            )
            .all()
        : []
    for (const sc of subchats) agentSessionManager.stopHost(sc.id)

    if (subchats.length > 0) {
      const refs = db
        .select({ checkpointRef: schema.messages.checkpointRef })
        .from(schema.messages)
        .where(
          and(
            inArray(
              schema.messages.subchatId,
              subchats.map((sc) => sc.id)
            ),
            isNotNull(schema.messages.checkpointRef)
          )
        )
        .all()
      const stashShas = refs
        .map((r) => (r.checkpointRef ? checkpointStashSha(r.checkpointRef) : null))
        .filter((sha): sha is string => sha !== null)
      try {
        await deleteCheckpointRefs(project.path, stashShas)
      } catch {
        // Repo may have been deleted from disk; removal must still succeed.
      }
    }

    // Kills project-root terminals and (by prefix) any worktree terminals.
    ptyManager.killByCwdPrefix(project.path)
    for (const chat of chats) {
      if (!chat.worktreePath) continue
      ptyManager.killByCwdPrefix(chat.worktreePath)
      try {
        await removeWorktree(project.path, chat.worktreePath, chat.branch ?? undefined)
      } catch {
        // Best-effort: don't block project removal on a broken worktree.
      }
    }

    db.delete(schema.projects).where(eq(schema.projects.id, project.id)).run()
    return { ok: true }
  }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ input }) => {
      getDb()
        .update(schema.projects)
        .set({ name: input.name, updatedAt: Date.now() })
        .where(eq(schema.projects.id, input.id))
        .run()
      return { ok: true }
    })
})
