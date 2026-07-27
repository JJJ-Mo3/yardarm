import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import * as schema from './schema'

export type DB = BetterSQLite3Database<typeof schema>

let db: DB | null = null
let sqlite: Database.Database | null = null

const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    default_branch TEXT,
    settings TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS projects_path_idx ON projects(path);

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    worktree_path TEXT,
    branch TEXT,
    base_branch TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chats_project_idx ON chats(project_id);

  CREATE TABLE IF NOT EXISTS subchats (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    mastra_thread_id TEXT,
    mode TEXT NOT NULL DEFAULT 'build',
    model_id TEXT,
    thinking_level TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS subchats_chat_idx ON subchats(chat_id);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    subchat_id TEXT NOT NULL REFERENCES subchats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    usage TEXT,
    checkpoint_ref TEXT,
    seq INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_subchat_idx ON messages(subchat_id, seq);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2 — one-time note (e.g. rollback) delivered with the next message send
  `ALTER TABLE subchats ADD COLUMN pending_note TEXT;`,
  // v3 — pending IDE-edit paths (JSON array) awaiting delivery to the agent
  `ALTER TABLE subchats ADD COLUMN pending_ide_edits TEXT;`,
  // v4 — project archiving (hidden from the picker's active list, restorable)
  `ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`,
  // v5 — full sandbox mode (OS-level isolation for agent shell commands)
  `ALTER TABLE subchats ADD COLUMN full_sandbox INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subchats ADD COLUMN sandbox_network INTEGER NOT NULL DEFAULT 1;`,
  // v6 — analytics: per-message model attribution + compression savings
  `ALTER TABLE messages ADD COLUMN model_id TEXT;
   CREATE TABLE IF NOT EXISTS compression_events (
     id TEXT PRIMARY KEY,
     subchat_id TEXT NOT NULL REFERENCES subchats(id) ON DELETE CASCADE,
     tokens_saved INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS compression_events_subchat_idx ON compression_events(subchat_id);`,
  // v7 — goal evaluation history (one row per judge verdict)
  `CREATE TABLE IF NOT EXISTS goal_evaluations (
     id TEXT PRIMARY KEY,
     subchat_id TEXT NOT NULL REFERENCES subchats(id) ON DELETE CASCADE,
     chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
     objective TEXT NOT NULL,
     iteration INTEGER NOT NULL,
     max_runs INTEGER NOT NULL,
     passed INTEGER NOT NULL,
     status TEXT NOT NULL,
     reason TEXT,
     paused_reason TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS goal_evaluations_chat_idx ON goal_evaluations(chat_id);`,
  // v8 — named checkpoints (manual snapshots alongside per-message auto ones)
  `CREATE TABLE IF NOT EXISTS checkpoints (
     id TEXT PRIMARY KEY,
     chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     tag TEXT,
     head_sha TEXT NOT NULL,
     stash_sha TEXT,
     source TEXT NOT NULL,
     message_id TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS checkpoints_chat_idx ON checkpoints(chat_id);`,
  // v9 — kanban cards (authored task cards that can dispatch agent chats)
  `CREATE TABLE IF NOT EXISTS kanban_cards (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     prompt TEXT NOT NULL,
     column_id TEXT NOT NULL,
     sort_order REAL NOT NULL,
     chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
     use_worktree INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS kanban_cards_project_idx ON kanban_cards(project_id);`
]

export function initDb(): DB {
  if (db) return db
  const dbPath = join(app.getPath('userData'), 'yardarm.db')
  sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')
  // Cap the WAL file so it can't balloon between checkpoints.
  sqlite.pragma('journal_size_limit = 16777216')
  sqlite.pragma('wal_autocheckpoint = 1000')

  // One-time switch to incremental auto-vacuum so deleted pages can be
  // reclaimed (requires a VACUUM to take effect; cheap while the DB is small).
  const autoVacuum = sqlite.pragma('auto_vacuum', { simple: true }) as number
  if (autoVacuum !== 2) {
    sqlite.pragma('auto_vacuum = INCREMENTAL')
    sqlite.exec('VACUUM')
  }

  const current = sqlite.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    sqlite.exec(MIGRATIONS[v])
    sqlite.pragma(`user_version = ${v + 1}`)
  }

  db = drizzle(sqlite, { schema })
  return db
}

/**
 * Reclaim free pages, truncate the WAL, and refresh query-planner stats.
 * Cheap when there's nothing to do; safe to call periodically.
 */
export function maintainDb(): void {
  if (!sqlite) return
  try {
    sqlite.pragma('incremental_vacuum')
    sqlite.pragma('wal_checkpoint(TRUNCATE)')
    sqlite.pragma('optimize')
  } catch (err) {
    console.error('[db] maintenance failed', err)
  }
}

export function getDb(): DB {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function closeDb(): void {
  maintainDb()
  sqlite?.close()
  sqlite = null
  db = null
}

export { schema }
