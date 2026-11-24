/**
 * Working-tree roots the app manages: project folders and chat worktrees.
 * Routers that touch the filesystem on the renderer's behalf accept a root
 * only when it is one of these, so a compromised renderer cannot point file
 * reads/writes or "open in app" at arbitrary directories.
 */
import path from 'node:path'
import { isNotNull } from 'drizzle-orm'
import { getDb, schema } from './db'

/** True when `dir` is a registered project folder or a chat's worktree. */
export function isKnownRoot(dir: string): boolean {
  const target = path.resolve(dir)
  const db = getDb()
  for (const p of db.select({ path: schema.projects.path }).from(schema.projects).all()) {
    if (path.resolve(p.path) === target) return true
  }
  const worktrees = db
    .select({ path: schema.chats.worktreePath })
    .from(schema.chats)
    .where(isNotNull(schema.chats.worktreePath))
    .all()
  return worktrees.some((w) => w.path !== null && path.resolve(w.path) === target)
}

/** Throw unless `dir` is a known root; returns it normalized. */
export function assertKnownRoot(dir: string): string {
  if (!isKnownRoot(dir)) throw new Error('Not a project or chat working directory')
  return path.resolve(dir)
}
