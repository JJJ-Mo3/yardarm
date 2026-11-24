/**
 * Shared chat creation: worktree provisioning + chat/subchat rows, used by
 * the chats router so the lifecycle stays single-sourced.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { isSetupTrusted } from '../db/project-settings'
import {
  createWorktree,
  ensureBaseCommit,
  isGitRepo,
  readSetupCommands,
  runSetupCommands
} from '../git/worktree'
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
  hidden: boolean
  createdAt: number
  updatedAt: number
  subchats: Array<typeof schema.subchats.$inferInsert>
  /**
   * Worktree setup commands that were NOT run because the user has not
   * approved them yet (empty when none or already trusted). Not persisted —
   * interactive callers prompt and call chats.approveSetup.
   */
  pendingSetupCommands: string[]
}

/** Create a chat (± its own worktree) and its first subchat. */
export async function createChatWithSubchat(input: {
  projectId: string
  title: string
  useWorktree: boolean
  baseBranch?: string
  /** App-managed background chat: kept out of the sidebar chat list. */
  hidden?: boolean
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
  let pendingSetupCommands: string[] = []
  // Worktrees need a base commit; bootstrap one for repos with an unborn
  // HEAD so isolation works even for freshly-initialized projects. Only
  // non-git project dirs fall back to running at the project root.
  if (input.useWorktree && (await isGitRepo(project.path))) {
    await ensureBaseCommit(project.path)
    const wt = await createWorktree(project.id, project.path, chatId, input.title, base)
    worktreePath = wt.worktreePath
    branch = wt.branch
    // Setup commands come from a repo file, so they only run once the user
    // approved this exact list; otherwise they are skipped and reported.
    const commands = await readSetupCommands(project.path)
    if (commands.length > 0) {
      if (isSetupTrusted(project.id, commands)) await runSetupCommands(wt.worktreePath, commands)
      else pendingSetupCommands = commands
    }
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
    hidden: input.hidden === true,
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

  return { ...chat, subchats: [subchat], pendingSetupCommands }
}
