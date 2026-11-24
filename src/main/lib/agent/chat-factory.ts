/**
 * Shared chat creation: worktree provisioning (trust-gated file copy + setup
 * commands) + chat/subchat rows, and the matching trust-gated teardown, used
 * by the chats and projects routers so the lifecycle stays single-sourced.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { CHAT_PORT_ENV, CHAT_PORT_RANGE_END_ENV, withChatPortEnv } from '@shared/chat-port'
import { getDb, schema } from '../db'
import { isSetupTrusted, projectEnvRecord } from '../db/project-settings'
import { copyUntrackedFiles, type CopyReport } from '../git/copy-untracked'
import {
  createWorktree,
  ensureBaseCommit,
  isGitRepo,
  readWorktreeConfig,
  runSetupCommands,
  runTeardownCommands
} from '../git/worktree'
import { isWorktreeConfigEmpty, type WorktreeConfig } from '../git/worktree-config'
import { readSettings } from '../mastra-config/settings-json'

/**
 * The chat's port variables for setup/teardown commands (so a setup step can
 * write the port into a local env file). Only these two — the commands
 * otherwise keep the plain app environment — and a YARDARM_PORT the user set
 * in project env wins.
 */
function chatPortVars(projectId: string, chatId: string): Record<string, string> {
  const merged = withChatPortEnv(projectEnvRecord(projectId), chatId)
  const out: Record<string, string> = {}
  for (const key of [CHAT_PORT_ENV, CHAT_PORT_RANGE_END_ENV]) {
    if (merged[key] !== undefined) out[key] = merged[key]
  }
  return out
}

/**
 * Apply an APPROVED worktree config to a chat's worktree: copy the untracked
 * files first (setup commands may need the .env they bring), then run the
 * setup commands. Callers check isSetupTrusted.
 */
export async function provisionWorktree(
  project: { id: string; path: string },
  chatId: string,
  worktreePath: string,
  config: WorktreeConfig
): Promise<CopyReport> {
  const report = await copyUntrackedFiles(project.path, worktreePath, config.copyFiles)
  await runSetupCommands(worktreePath, config.setup, chatPortVars(project.id, chatId))
  return report
}

/**
 * Run the project's teardown commands in a chat worktree that is about to be
 * removed — only when the current .yardarm/worktree.json is approved.
 * Best-effort: never throws, and an unapproved config runs nothing.
 */
export async function runTrustedTeardown(
  project: { id: string; path: string },
  chat: { id: string; worktreePath: string | null }
): Promise<void> {
  if (!chat.worktreePath) return
  try {
    const config = await readWorktreeConfig(project.path)
    if (config.teardown.length === 0 || !isSetupTrusted(project.id, config)) return
    await runTeardownCommands(chat.worktreePath, config.teardown, chatPortVars(project.id, chat.id))
  } catch (err) {
    console.error('[worktree] teardown failed', err)
  }
}

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
  /** Copy-file patterns that were NOT applied, for the same reason (same approval). */
  pendingCopyFiles: string[]
  /** Teardown commands awaiting the same approval (they would run on delete). */
  pendingTeardownCommands: string[]
  /** Untracked files matched the copy patterns but a count/size cap left some out. */
  copyCapped: boolean
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
  let pending: WorktreeConfig = { setup: [], copyFiles: [], teardown: [] }
  let copyCapped = false
  // Worktrees need a base commit; bootstrap one for repos with an unborn
  // HEAD so isolation works even for freshly-initialized projects. Only
  // non-git project dirs fall back to running at the project root.
  if (input.useWorktree && (await isGitRepo(project.path))) {
    await ensureBaseCommit(project.path)
    const wt = await createWorktree(project.id, project.path, chatId, input.title, base)
    worktreePath = wt.worktreePath
    branch = wt.branch
    // The config comes from a repo file, so files are copied and commands run
    // only once the user approved this exact content; otherwise everything is
    // skipped and reported.
    const config = await readWorktreeConfig(project.path)
    if (!isWorktreeConfigEmpty(config)) {
      if (isSetupTrusted(project.id, config)) {
        const report = await provisionWorktree(project, chatId, wt.worktreePath, config)
        copyCapped = report.capped
      } else {
        pending = config
      }
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

  return {
    ...chat,
    subchats: [subchat],
    pendingSetupCommands: pending.setup,
    pendingCopyFiles: pending.copyFiles,
    pendingTeardownCommands: pending.teardown,
    copyCapped
  }
}
