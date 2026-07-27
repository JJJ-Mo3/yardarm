import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    defaultBranch: text('default_branch'),
    settings: text('settings'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('projects_path_idx').on(t.path)]
)

export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    worktreePath: text('worktree_path'),
    branch: text('branch'),
    baseBranch: text('base_branch'),
    status: text('status').notNull().default('idle'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('chats_project_idx').on(t.projectId)]
)

export const subchats = sqliteTable(
  'subchats',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    mastraThreadId: text('mastra_thread_id'),
    mode: text('mode').notNull().default('build'),
    modelId: text('model_id'),
    thinkingLevel: text('thinking_level'),
    /** One-time note (e.g. rollback) appended to the next model-bound prompt. */
    pendingNote: text('pending_note'),
    /** JSON array of IDE-edited paths awaiting delivery to the agent. */
    pendingIdeEdits: text('pending_ide_edits'),
    /** Full sandbox mode: OS-level isolation for agent shell commands. */
    fullSandbox: integer('full_sandbox', { mode: 'boolean' }).notNull().default(false),
    /** Whether sandboxed shell commands may access the network. */
    sandboxNetwork: integer('sandbox_network', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('subchats_chat_idx').on(t.chatId)]
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    subchatId: text('subchat_id')
      .notNull()
      .references(() => subchats.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    parts: text('parts').notNull(),
    usage: text('usage'),
    /** Model that produced this assistant message (populated from v6 on). */
    modelId: text('model_id'),
    checkpointRef: text('checkpoint_ref'),
    seq: integer('seq').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('messages_subchat_idx').on(t.subchatId, t.seq)]
)

/**
 * Tokens saved by prompt compression. One row per agent-host lifetime; the
 * host reports a cumulative figure, so each row is upserted with the latest
 * value and totals are the sum across rows.
 */
export const compressionEvents = sqliteTable(
  'compression_events',
  {
    id: text('id').primaryKey(),
    subchatId: text('subchat_id')
      .notNull()
      .references(() => subchats.id, { onDelete: 'cascade' }),
    tokensSaved: integer('tokens_saved').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('compression_events_subchat_idx').on(t.subchatId)]
)

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
