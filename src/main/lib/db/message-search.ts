/**
 * Cross-chat message search index (FTS5, created by migration v27). Rows are
 * written here from JS — on every message upsert and for forked transcript
 * copies — because the indexed text (text parts only, marker lines stripped)
 * can't be derived in SQL; deletions are handled by the `messages_search_ad`
 * trigger, which also covers rollbacks and chat/project cascade deletes.
 * Messages that predate the index are backfilled lazily, in small chunks, the
 * first time search is used. Indexing is best-effort: a failure here must
 * never break message persistence.
 */
import type Database from 'better-sqlite3'
import {
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  buildFtsQuery,
  extractSearchText,
  type MessageSearchHit
} from '../../../shared/message-search'
import { getSqlite } from './index'

interface Statements {
  selMap: Database.Statement
  setMap: Database.Statement
  selBody: Database.Statement
  insDoc: Database.Statement
  updDoc: Database.Statement
  delDoc: Database.Statement
}

const statements = new WeakMap<Database.Database, Statements>()

function prepared(sqlite: Database.Database): Statements {
  let s = statements.get(sqlite)
  if (!s) {
    s = {
      selMap: sqlite.prepare('SELECT doc_id FROM message_search_map WHERE message_id = ?'),
      setMap: sqlite.prepare(
        'INSERT INTO message_search_map (message_id, doc_id) VALUES (?, ?) ' +
          'ON CONFLICT(message_id) DO UPDATE SET doc_id = excluded.doc_id'
      ),
      selBody: sqlite.prepare('SELECT body FROM message_search WHERE rowid = ?'),
      insDoc: sqlite.prepare(
        'INSERT INTO message_search (message_id, subchat_id, role, body) VALUES (?, ?, ?, ?)'
      ),
      updDoc: sqlite.prepare('UPDATE message_search SET body = ? WHERE rowid = ?'),
      delDoc: sqlite.prepare('DELETE FROM message_search WHERE rowid = ?')
    }
    statements.set(sqlite, s)
  }
  return s
}

/** Insert, refresh or drop one message's index entry to match `body`. */
function upsertDoc(
  sqlite: Database.Database,
  id: string,
  subchatId: string,
  role: string,
  body: string
): void {
  const s = prepared(sqlite)
  const map = s.selMap.get(id) as { doc_id: number | null } | undefined
  const docId = map?.doc_id ?? null
  if (!body) {
    if (docId !== null) s.delDoc.run(docId)
    // A NULL doc id still marks the message as processed for the backfill.
    if (!map || docId !== null) s.setMap.run(id, null)
    return
  }
  if (docId !== null) {
    // Streaming re-persists the same message many times — skip no-op rewrites.
    const current = s.selBody.get(docId) as { body: string } | undefined
    if (current?.body === body) return
    if (current) {
      s.updDoc.run(body, docId)
      return
    }
  }
  const res = s.insDoc.run(id, subchatId, role, body)
  s.setMap.run(id, Number(res.lastInsertRowid))
}

/** Index (or re-index) one message. `parts` is the parsed parts array. */
export function indexMessage(
  subchatId: string,
  message: { id: string; role: string; parts: unknown }
): void {
  try {
    upsertDoc(
      getSqlite(),
      message.id,
      subchatId,
      message.role,
      extractSearchText(message.role, message.parts)
    )
  } catch (err) {
    console.error('[message-search] index failed', err)
  }
}

interface RawMessageRow {
  id: string
  subchat_id: string
  role: string
  parts: string
}

function indexRawRows(sqlite: Database.Database, rows: RawMessageRow[]): void {
  sqlite.transaction(() => {
    for (const r of rows) {
      let parts: unknown = null
      try {
        parts = JSON.parse(r.parts)
      } catch {
        // Unparseable row — recorded as processed with nothing to index.
      }
      upsertDoc(sqlite, r.id, r.subchat_id, r.role, extractSearchText(r.role, parts))
    }
  })()
}

/** Index stored rows that were inserted outside the upsert path (fork copies). */
export function indexStoredMessages(
  rows: Array<{ id: string; subchatId: string; role: string; parts: string }>
): void {
  if (rows.length === 0) return
  try {
    indexRawRows(
      getSqlite(),
      rows.map((r) => ({ id: r.id, subchat_id: r.subchatId, role: r.role, parts: r.parts }))
    )
  } catch (err) {
    console.error('[message-search] bulk index failed', err)
  }
}

// ---- Lazy backfill of messages that predate the index ----------------------

const BACKFILL_FLAG = 'messageSearchBackfilled'
const BACKFILL_CHUNK = 200
const BACKFILL_PAUSE_MS = 15

let backfillState: 'unknown' | 'running' | 'done' = 'unknown'

function backfillStep(afterRowid: number): void {
  let sqlite: Database.Database
  try {
    sqlite = getSqlite()
  } catch {
    // DB closed (app quitting) — the next launch resumes from the map table.
    backfillState = 'unknown'
    return
  }
  try {
    const rows = sqlite
      .prepare(
        'SELECT m.rowid AS rid, m.id, m.subchat_id, m.role, m.parts FROM messages m ' +
          'WHERE m.rowid > ? AND NOT EXISTS ' +
          '(SELECT 1 FROM message_search_map s WHERE s.message_id = m.id) ' +
          'ORDER BY m.rowid LIMIT ?'
      )
      .all(afterRowid, BACKFILL_CHUNK) as Array<RawMessageRow & { rid: number }>
    indexRawRows(sqlite, rows)
    if (rows.length < BACKFILL_CHUNK) {
      sqlite
        .prepare(
          'INSERT INTO app_settings (key, value) VALUES (?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run(BACKFILL_FLAG, 'true')
      backfillState = 'done'
      return
    }
    const next = rows[rows.length - 1].rid
    setTimeout(() => backfillStep(next), BACKFILL_PAUSE_MS)
  } catch (err) {
    console.error('[message-search] backfill failed', err)
    // Retry from scratch on the next search (processed rows are skipped).
    backfillState = 'unknown'
  }
}

/**
 * Make sure older messages are (being) indexed. Returns true while the
 * chunked backfill is still running, so callers can say results are partial.
 */
export function ensureSearchBackfill(): boolean {
  if (backfillState === 'done') return false
  if (backfillState === 'running') return true
  try {
    const flag = getSqlite()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(BACKFILL_FLAG) as { value: string } | undefined
    if (flag?.value === 'true') {
      backfillState = 'done'
      return false
    }
  } catch {
    return false
  }
  backfillState = 'running'
  setTimeout(() => backfillStep(0), 0)
  return true
}

// ---- Query ------------------------------------------------------------------

/**
 * Full-text search across every visible chat (hidden app-managed chats are
 * excluded — they can't be opened). Best matches first, newest first among
 * equals. Returns [] for input with no searchable term.
 */
export function searchMessages(input: string, limit: number): MessageSearchHit[] {
  const match = buildFtsQuery(input)
  if (!match) return []
  try {
    const rows = getSqlite()
      .prepare(
        'SELECT s.message_id AS messageId, s.subchat_id AS subchatId, s.role AS role, ' +
          "snippet(message_search, 3, ?, ?, '…', 18) AS snippet, " +
          'm.created_at AS createdAt, c.id AS chatId, c.title AS chatTitle, ' +
          'c.archived AS chatArchived, p.id AS projectId, p.name AS projectName ' +
          'FROM message_search s ' +
          'JOIN messages m ON m.id = s.message_id ' +
          'JOIN subchats sc ON sc.id = m.subchat_id ' +
          'JOIN chats c ON c.id = sc.chat_id ' +
          'JOIN projects p ON p.id = c.project_id ' +
          'WHERE message_search MATCH ? AND c.hidden = 0 ' +
          'ORDER BY rank, m.created_at DESC LIMIT ?'
      )
      .all(SNIPPET_OPEN, SNIPPET_CLOSE, match, limit) as Array<
      Omit<MessageSearchHit, 'chatArchived' | 'role'> & { chatArchived: number; role: string }
    >
    return rows.map((r) => ({
      ...r,
      role: r.role === 'user' ? 'user' : 'assistant',
      chatArchived: r.chatArchived === 1
    }))
  } catch (err) {
    console.error('[message-search] query failed', err)
    return []
  }
}
