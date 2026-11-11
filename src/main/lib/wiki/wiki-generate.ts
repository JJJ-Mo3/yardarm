/**
 * Behind-the-scenes wiki generation: runs as a marked agent task in a
 * dedicated per-project "Repo wiki" chat (lazily created at the project
 * root, persisted on projects.wiki_chat_id), so no user chat needs to be
 * selected. Staging is prepared here, the prompt is dispatched through the
 * session manager, and the finished pages are collected into the per-project
 * store from the run-finished event — the renderer only polls status.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { buildWikiPrompt, WIKI_MARKER } from '@shared/wiki'
import { getDb, schema } from '../db'
import { agentSessionManager } from '../agent/agent-session-manager'
import { createChatWithSubchat } from '../agent/chat-factory'
import { notifyAgentEvent } from '../notifications'
import {
  collectStaging,
  ensureExcludeLine,
  wikiDir,
  WIKI_STAGING_DIR,
  writeStagingMeta
} from './wiki-fs'

export const WIKI_CHAT_TITLE = 'Repo wiki'

/** In-flight generation per project (double-start guard + status polling). */
const inflight = new Map<string, { chatId: string; subchatId: string }>()

/** Why the last generation produced no wiki (per project), for the Wiki tab.
 * The run happens in a background chat nobody is watching, so run errors
 * (expired provider sign-in, crashed host, a run that wrote no pages) must
 * be carried to the status poll or the failure is completely silent. */
const lastFailure = new Map<string, string>()

function storeDir(projectId: string): string {
  return wikiDir(app.getPath('userData'), projectId)
}

/** Serialize collection per project: the run-finished collect and the status
 * poll's recovery collect must never interleave on the same staging dir. */
const collecting = new Map<string, Promise<boolean>>()
function collect(projectId: string, cwd: string): Promise<boolean> {
  const existing = collecting.get(projectId)
  if (existing) return existing
  const p = collectStaging(cwd, storeDir(projectId)).finally(() => collecting.delete(projectId))
  collecting.set(projectId, p)
  return p
}

interface WikiTarget {
  chatId: string
  subchatId: string
  cwd: string
}

/**
 * Resolve the project's dedicated wiki chat (+ its earliest subchat),
 * creating a fresh one when the stored chat is gone or archived. The chat
 * runs at the project root (no worktree): the wiki should document the
 * project's current state, and the run only writes into the git-excluded
 * staging folder.
 */
async function resolveWikiChat(projectId: string): Promise<WikiTarget> {
  const db = getDb()
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()
  if (!project) throw new Error('Project not found')
  if (project.wikiChatId) {
    const chat = db.select().from(schema.chats).where(eq(schema.chats.id, project.wikiChatId)).get()
    if (chat && !chat.archived) {
      const subchat = db
        .select()
        .from(schema.subchats)
        .where(eq(schema.subchats.chatId, chat.id))
        .orderBy(asc(schema.subchats.createdAt))
        .get()
      if (subchat) {
        return { chatId: chat.id, subchatId: subchat.id, cwd: chat.worktreePath ?? project.path }
      }
    }
  }
  const created = await createChatWithSubchat({
    projectId,
    title: WIKI_CHAT_TITLE,
    useWorktree: false
  })
  db.update(schema.projects)
    .set({ wikiChatId: created.id, updatedAt: Date.now() })
    .where(eq(schema.projects.id, projectId))
    .run()
  return { chatId: created.id, subchatId: created.subchats[0].id, cwd: project.path }
}

/** Pre-generation setup: keep .yardarm-wiki/ out of git + write staging meta. */
async function prepareStaging(cwd: string, projectId: string): Promise<void> {
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
}

export interface WikiGenerateResult {
  started: boolean
  chatId: string
}

/**
 * Kick off a wiki generation run in the project's dedicated chat. Returns
 * started=false (never queues) when a generation is already underway or the
 * wiki chat is busy.
 */
export async function startWikiGeneration(projectId: string): Promise<WikiGenerateResult> {
  const target = await resolveWikiChat(projectId)
  if (!existsSync(target.cwd)) throw new Error(`Folder no longer exists: ${target.cwd}`)
  if (
    inflight.has(projectId) ||
    agentSessionManager.isRunning(target.subchatId) ||
    agentSessionManager.queuedPrompts(target.subchatId).length > 0
  ) {
    return { started: false, chatId: target.chatId }
  }
  await prepareStaging(target.cwd, projectId)
  lastFailure.delete(projectId)
  // The run happens behind the scenes — nobody is watching the dedicated
  // wiki chat to answer tool approvals, so without auto-approve the first
  // file write would park the run forever. Real consent surfaces (ask_user
  // questions, plan review) still suspend and are reported via status.waiting.
  await agentSessionManager.setYolo(target.subchatId, true)
  // Collect once the run completes; the listener also detaches on host
  // errors so repeated generations can't accumulate listeners. Run errors
  // (e.g. an expired provider sign-in) stream only into the hidden wiki
  // chat, so remember the latest one for the Wiki tab's failure banner.
  let lastError: string | null = null
  const off = agentSessionManager.onEvents(target.subchatId, (ev) => {
    if (ev.type === 'info' && ev.level === 'error') {
      lastError = ev.text
    } else if (ev.type === 'run-finished') {
      // A suspended end (the agent asked a question) isn't done: keep the
      // run inflight so the Wiki tab can point the user at the chat; the
      // answered run resumes and finishes with a later run-finished.
      if (ev.reason === 'suspended') return
      off()
      inflight.delete(projectId)
      void collect(projectId, target.cwd)
        .then((collected) => {
          if (collected) {
            lastFailure.delete(projectId)
            notifyAgentEvent('Repo wiki generated', target.chatId, target.subchatId)
          } else {
            lastFailure.set(
              projectId,
              lastError ??
                (ev.reason === 'error'
                  ? 'The run failed before writing any wiki pages.'
                  : 'The run finished without writing any wiki pages.')
            )
            notifyAgentEvent('Repo wiki generation failed', target.chatId, target.subchatId)
          }
        })
        .catch((err) => console.error('[wiki] collect failed', projectId, err))
    } else if (ev.type === 'status' && ev.status === 'error') {
      off()
      inflight.delete(projectId)
      lastFailure.set(projectId, ev.error ?? lastError ?? 'The agent failed to start.')
    }
  })
  inflight.set(projectId, { chatId: target.chatId, subchatId: target.subchatId })
  try {
    await agentSessionManager.sendOrQueue(
      target.subchatId,
      buildWikiPrompt(),
      undefined,
      WIKI_MARKER,
      'marker'
    )
  } catch (err) {
    off()
    inflight.delete(projectId)
    throw err
  }
  return { started: true, chatId: target.chatId }
}

export interface WikiGenerationStatus {
  running: boolean
  /** The dedicated wiki chat, when one exists (for "View run"). */
  chatId: string | null
  /** True when leftover staging was just recovered into the store. */
  collected: boolean
  /** True when the run is parked on a question/approval and needs the user. */
  waiting: boolean
  /** Why the last generation produced no wiki, when it failed (idle only). */
  error: string | null
}

/**
 * Live generation status, plus opportunistic recovery of leftover staging
 * (e.g. the app closed mid-run) once the wiki chat is idle. collectStaging
 * is a no-op without finished pages, so polling this is cheap and safe.
 */
export async function wikiGenerationStatus(projectId: string): Promise<WikiGenerationStatus> {
  const run = inflight.get(projectId)
  if (run) {
    return {
      running: true,
      chatId: run.chatId,
      collected: false,
      waiting: agentSessionManager.awaitingUserInput(run.subchatId),
      error: null
    }
  }
  const db = getDb()
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()
  const chat = project?.wikiChatId
    ? db.select().from(schema.chats).where(eq(schema.chats.id, project.wikiChatId)).get()
    : undefined
  if (!chat || chat.archived) {
    return {
      running: false,
      chatId: null,
      collected: false,
      waiting: false,
      error: lastFailure.get(projectId) ?? null
    }
  }
  const cwd = chat.worktreePath ?? project?.path ?? ''
  let collected = false
  const subchat = db
    .select()
    .from(schema.subchats)
    .where(eq(schema.subchats.chatId, chat.id))
    .orderBy(asc(schema.subchats.createdAt))
    .get()
  // Only recover while the wiki chat is idle, so a manual run in that chat
  // can't have its half-written staging collected out from under it.
  const busy = subchat ? agentSessionManager.isRunning(subchat.id) : false
  if (!busy && cwd && existsSync(cwd)) {
    try {
      collected = await collect(projectId, cwd)
      if (collected) lastFailure.delete(projectId)
    } catch {
      // best-effort recovery
    }
  }
  return {
    running: false,
    chatId: chat.id,
    collected,
    waiting: false,
    error: lastFailure.get(projectId) ?? null
  }
}
