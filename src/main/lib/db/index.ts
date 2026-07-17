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
  `
]

export function initDb(): DB {
  if (db) return db
  const dbPath = join(app.getPath('userData'), 'codezero.db')
  sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const current = sqlite.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    sqlite.exec(MIGRATIONS[v])
    sqlite.pragma(`user_version = ${v + 1}`)
  }

  db = drizzle(sqlite, { schema })
  return db
}

export function getDb(): DB {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function closeDb(): void {
  sqlite?.close()
  sqlite = null
  db = null
}

export { schema }
