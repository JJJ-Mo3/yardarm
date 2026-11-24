/**
 * Inbox model shared by the main process (which reports what its live agent
 * hosts actually know) and the renderer (which owns the "finished — not
 * viewed" flags). Pure: grouping, ordering and the compact one-line summaries
 * of pending tool calls and questions.
 */
import type { PendingApproval } from './ui-message'

/** One subchat with a live agent host that is running or waiting on the user. */
export interface InboxLiveEntry {
  subchatId: string
  chatId: string
  chatTitle: string
  projectId: string
  projectName: string
  running: boolean
  /** When the current run started (ms), if one is in flight. */
  runningSince: number | null
  approvals: Array<PendingApproval & { since: number }>
  questions: Array<{ toolCallId: string; toolName: string; summary: string; since: number }>
}

/** A chat the renderer flagged as finished-but-not-viewed, with its titles. */
export interface InboxUnseenEntry {
  chatId: string
  chatTitle: string
  projectId: string
  projectName: string
  /** When its last run finished (ms); falls back to the chat's last activity. */
  finishedAt: number
}

export interface InboxSnapshot {
  live: InboxLiveEntry[]
  unseen: InboxUnseenEntry[]
}

export type InboxGroupId = 'approval' | 'question' | 'finished' | 'running'

export const INBOX_GROUP_LABELS: Record<InboxGroupId, string> = {
  approval: 'Needs approval',
  question: 'Asked a question',
  finished: 'Finished — not viewed',
  running: 'Running'
}

export interface InboxRow {
  key: string
  group: InboxGroupId
  projectId: string
  projectName: string
  chatId: string
  chatTitle: string
  /** Conversation tab to open; null lets the opener pick the chat's first tab. */
  subchatId: string | null
  /** Timestamp the row's state began (ms) — rendered as "how long ago". */
  since: number
  /** Pending tool calls (approval rows only). */
  approvals: Array<PendingApproval & { since: number }>
  /** One-line question / request summaries (question rows only). */
  questions: string[]
}

export interface InboxGroup {
  id: InboxGroupId
  label: string
  rows: InboxRow[]
}

const GROUP_ORDER: InboxGroupId[] = ['approval', 'question', 'finished', 'running']

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Argument keys that best describe a tool call, most telling first. */
const TELLING_KEYS = ['command', 'path', 'file_path', 'filePath', 'url', 'query', 'pattern', 'name']

/** Compact one-line description of a tool call's arguments (for inbox rows). */
export function summarizeToolArgs(args: unknown, max = 140): string {
  let value = args
  if (typeof args === 'string') {
    try {
      value = JSON.parse(args)
    } catch {
      return truncate(args, max)
    }
  }
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return truncate(String(value), max)
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of TELLING_KEYS) {
      const v = record[key]
      if (typeof v === 'string' && v.trim()) return truncate(v, max)
    }
  }
  try {
    return truncate(JSON.stringify(value), max)
  } catch {
    return ''
  }
}

/** One-line summary of a suspended tool call that is waiting on the user. */
export function summarizeSuspension(toolName: string, payload: unknown, max = 160): string {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  if (toolName === 'ask_user') {
    const q = typeof record.question === 'string' ? record.question : ''
    return q.trim() ? truncate(q, max) : 'The agent has a question.'
  }
  if (toolName === 'submit_plan') {
    const title = typeof record.title === 'string' ? record.title : ''
    return title.trim() ? truncate(`Plan ready for review: ${title}`, max) : 'Plan ready for review'
  }
  if (toolName === 'request_access') {
    const path = typeof record.path === 'string' ? record.path : ''
    return path.trim()
      ? truncate(`Requests sandbox access to ${path}`, max)
      : 'Requests sandbox access'
  }
  return truncate(`${toolName} is waiting for your input`, max)
}

/**
 * Group the snapshot into the inbox's sections. Each live subchat lands in
 * exactly one group (approval beats question beats running); an unseen chat
 * is listed as finished only while none of its subchats is live in another
 * group. Empty groups are omitted; rows are oldest-waiting first, except
 * finished rows which are newest first.
 */
export function buildInboxGroups(snapshot: InboxSnapshot): InboxGroup[] {
  const rows: InboxRow[] = []
  const liveChats = new Set<string>()
  for (const e of snapshot.live) {
    const base = {
      projectId: e.projectId,
      projectName: e.projectName,
      chatId: e.chatId,
      chatTitle: e.chatTitle,
      subchatId: e.subchatId
    }
    if (e.approvals.length > 0) {
      rows.push({
        ...base,
        key: `approval:${e.subchatId}`,
        group: 'approval',
        since: Math.min(...e.approvals.map((a) => a.since)),
        approvals: e.approvals,
        questions: []
      })
    } else if (e.questions.length > 0) {
      rows.push({
        ...base,
        key: `question:${e.subchatId}`,
        group: 'question',
        since: Math.min(...e.questions.map((q) => q.since)),
        approvals: [],
        questions: e.questions.map((q) => q.summary)
      })
    } else if (e.running) {
      rows.push({
        ...base,
        key: `running:${e.subchatId}`,
        group: 'running',
        since: e.runningSince ?? Date.now(),
        approvals: [],
        questions: []
      })
    } else {
      continue
    }
    liveChats.add(e.chatId)
  }
  for (const u of snapshot.unseen) {
    if (liveChats.has(u.chatId)) continue
    rows.push({
      key: `finished:${u.chatId}`,
      group: 'finished',
      projectId: u.projectId,
      projectName: u.projectName,
      chatId: u.chatId,
      chatTitle: u.chatTitle,
      subchatId: null,
      since: u.finishedAt,
      approvals: [],
      questions: []
    })
  }
  const groups: InboxGroup[] = []
  for (const id of GROUP_ORDER) {
    const members = rows.filter((r) => r.group === id)
    if (members.length === 0) continue
    members.sort((a, b) => (id === 'finished' ? b.since - a.since : a.since - b.since))
    groups.push({ id, label: INBOX_GROUP_LABELS[id], rows: members })
  }
  return groups
}

/** Rows that need the user (everything except plain running) — the badge count. */
export function inboxAttentionCount(groups: InboxGroup[]): number {
  return groups.filter((g) => g.id !== 'running').reduce((n, g) => n + g.rows.length, 0)
}
