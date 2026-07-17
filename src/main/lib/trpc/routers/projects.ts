import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../../db'
import { detectDefaultBranch, isGitRepo } from '../../git/worktree'
import { publicProcedure, router } from '../trpc'

export const projectsRouter = router({
  list: publicProcedure.query(() => {
    return getDb().select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all()
  }),

  /** Open a native folder picker and add the selected folder as a project. */
  addViaDialog: publicProcedure.mutation(async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    const projectPath = res.filePaths[0]

    const db = getDb()
    const existing = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.path, projectPath))
      .get()
    if (existing) return existing

    if (!(await isGitRepo(projectPath))) {
      throw new Error('Selected folder is not a git repository')
    }

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
  }),

  remove: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    getDb().delete(schema.projects).where(eq(schema.projects.id, input.id)).run()
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
