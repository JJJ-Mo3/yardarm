/**
 * Shared chat creation: worktree provisioning + chat/subchat rows, used by
 * both the chats router (manual "New chat") and the kanban router (card
 * dispatch) so the lifecycle stays single-sourced.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { createWorktree, ensureBaseCommit, isGitRepo } from '../git/worktree'
import { readSettings } from '../mastra-config/settings-json'

/**
 * Global new-chat defaults for full sandbox mode (app_settings KV, written by
 * the Preferences tab via the settings router). The per-subchat columns are
 * the source of truth after creation.
 */
export function sandboxDefaults(): { enabled: boolean; allowNetwork: boolean } {
  try {
    const row = getDb()
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, 'sandboxDefaults'))
      .get()
    if (row) {
      const v = JSON.parse(row.value) as { enabled?: boolean; allowNetwork?: boolean }
      return { enabled: v.enabled === true, allowNetwork: v.allowNetwork !== false }
    }
  } catch {}
  return { enabled: false, allowNetwork: true }
}

/**
 * Global new-chat default for YOLO mode (preferences.yolo in mastracode's
 * shared settings.json, written by Preferences and onboarding). Like the
 * sandbox defaults, the per-subchat column is the source of truth afterwards.
 */
export async function yoloDefault(): Promise<boolean> {
  try {
    return (await readSettings()).preferences?.yolo === true
  } catch {
    return false
  }
}

export interface CreatedChat {
  id: string
  projectId: string
  title: string
  worktreePath: string | null
  branch: string | null
  baseBranch: string
  status: string
  archived: boolean
  createdAt: number
  updatedAt: number
  subchats: Array<typeof schema.subchats.$inferInsert>
}

/** Create a chat (± its own worktree) and its first subchat. */
export async function createChatWithSubchat(input: {
  projectId: string
  title: string
  useWorktree: boolean
  baseBranch?: string
}): Promise<CreatedChat> {
  const db = getDb()
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, input.projectId))
    .get()
  if (!project) throw new Error('Project not found')

  const chatId = randomUUID()
  const base = input.baseBranch ?? project.defaultBranch ?? 'main'

  let worktreePath: string | null = null
  let branch: string | null = null
  // Worktrees need a base commit; bootstrap one for repos with an unborn
  // HEAD so isolation works even for freshly-initialized projects. Only
  // non-git project dirs fall back to running at the project root.
  if (input.useWorktree && (await isGitRepo(project.path))) {
    await ensureBaseCommit(project.path)
    const wt = await createWorktree(project.id, project.path, chatId, input.title, base)
    worktreePath = wt.worktreePath
    branch = wt.branch
  }

  const now = Date.now()
  const chat = {
    id: chatId,
    projectId: project.id,
    title: input.title,
    worktreePath,
    branch,
    baseBranch: base,
    status: 'active',
    archived: false,
    createdAt: now,
    updatedAt: now
  }
  db.insert(schema.chats).values(chat).run()

  const sandbox = sandboxDefaults()
  const subchat = {
    id: randomUUID(),
    chatId,
    mastraThreadId: null,
    mode: 'build',
    modelId: null,
    thinkingLevel: null,
    fullSandbox: sandbox.enabled,
    sandboxNetwork: sandbox.allowNetwork,
    yolo: await yoloDefault(),
    createdAt: now,
    updatedAt: now
  }
  db.insert(schema.subchats).values(subchat).run()

  return { ...chat, subchats: [subchat] }
}
