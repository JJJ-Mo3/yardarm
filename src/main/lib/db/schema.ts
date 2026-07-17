import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    defaultBranch: text('default_branch'),
    settings: text('settings'),
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
    checkpointRef: text('checkpoint_ref'),
    seq: integer('seq').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('messages_subchat_idx').on(t.subchatId, t.seq)]
)

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
