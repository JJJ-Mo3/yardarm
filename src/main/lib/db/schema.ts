import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    defaultBranch: text('default_branch'),
    settings: text('settings'),
    /** Dedicated wiki-generation chat, lazily created on first /wiki generate. */
    wikiChatId: text('wiki_chat_id'),
    /** Dedicated codebase Q&A chat backing the wiki Ask panel, lazily created. */
    askChatId: text('ask_chat_id'),
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
    /** Pinned chats sort to the top of the sidebar, before manual order. */
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    /** App-managed background chats (Repo wiki, Ask panel) — kept out of chat lists. */
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    /** User-defined sidebar position; NULL rows sort after, by recency. */
    sortOrder: real('sort_order'),
    /** AI-generated session insights (markdown); regenerated on demand. */
    insights: text('insights'),
    insightsGeneratedAt: integer('insights_generated_at'),
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
    /** Auto-approve all tool calls (YOLO); seeded from preferences.yolo at creation. */
    yolo: integer('yolo', { mode: 'boolean' }).notNull().default(false),
    /** Self-verification override for this subchat; NULL = follow the global setting. */
    verifyWork: integer('verify_work', { mode: 'boolean' }),
    /** Tasks auto-continue override for this subchat; NULL = follow the global setting. */
    autoContinue: integer('auto_continue', { mode: 'boolean' }),
    /** Subchat this tab was forked from (fork-from-message); NULL = not a fork. */
    forkedFromSubchatId: text('forked_from_subchat_id'),
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

/**
 * Named checkpoints created from the checkpoint manager. Auto (per-message)
 * checkpoints stay on messages.checkpoint_ref; a row here pins a snapshot
 * with a user-given name so prune never collects it.
 */
export const checkpoints = sqliteTable(
  'checkpoints',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tag: text('tag'),
    headSha: text('head_sha').notNull(),
    stashSha: text('stash_sha'),
    source: text('source').notNull(),
    messageId: text('message_id'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('checkpoints_chat_idx').on(t.chatId)]
)

/** One row per goal-judge verdict (goal_evaluation events), kept as history. */
export const goalEvaluations = sqliteTable(
  'goal_evaluations',
  {
    id: text('id').primaryKey(),
    subchatId: text('subchat_id')
      .notNull()
      .references(() => subchats.id, { onDelete: 'cascade' }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    objective: text('objective').notNull(),
    iteration: integer('iteration').notNull(),
    maxRuns: integer('max_runs').notNull(),
    passed: integer('passed', { mode: 'boolean' }).notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    pausedReason: text('paused_reason'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('goal_evaluations_chat_idx').on(t.chatId)]
)

/**
 * App-managed recurring agent runs. The
 * main-process scheduler fires due rows while the app is open; `cadence` is a
 * JSON ScheduleCadence (src/shared/schedules.ts) and `next_run_at` is
 * persisted so catch-up after relaunch is a plain `<= now` comparison.
 */
export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    /** JSON-encoded ScheduleCadence. */
    cadence: text('cadence').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** Fixed target chat, lazily created on first fire; NULL = recreate next fire. */
    chatId: text('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    useWorktree: integer('use_worktree', { mode: 'boolean' }).notNull().default(false),
    lastRunAt: integer('last_run_at'),
    /** 'ok' | 'error' | 'skipped' (skipped = target chat was busy). */
    lastRunStatus: text('last_run_status'),
    nextRunAt: integer('next_run_at'),
    /** When set, firing runs this workflow (run-book) instead of sending `prompt`. */
    workflowId: text('workflow_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('schedules_project_idx').on(t.projectId)]
)

/**
 * Workflows: app-managed run-books over SDK-stored workflow definitions —
 * Yardarm metadata (name, description, default input, last-run state) layered
 * on a definition that lives in the agent SDK's own storage. Distinct from the
 * SDK definition storage itself (definition_id is a plain SDK-storage id
 * string, not an app FK) and from scheduled runs (which may optionally fire a
 * workflow).
 */
export const workflows = sqliteTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Id of the definition in SDK storage (resolved via the chat's agent host). */
    definitionId: text('definition_id').notNull(),
    /** JSON object used as the run input when none is provided. */
    defaultInputJson: text('default_input_json'),
    lastRunAt: integer('last_run_at'),
    /** 'ok' | 'error'. */
    lastRunStatus: text('last_run_status'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('workflows_project_idx').on(t.projectId)]
)

/**
 * Editable knowledge notes: user-authored,
 * project-scoped notes injected into agent boots — pinned bodies go into the
 * system prompt, the rest are fetchable via the knowledge_note_lookup tool
 * (caps in src/shared/knowledge-notes.ts). Distinct from the SDK's
 * experimental knowledge base (agent memory).
 */
export const knowledgeNotes = sqliteTable(
  'knowledge_notes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Pinned bodies are inlined into the system prompt (byte-budgeted). */
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** 'user' (hand-written) | 'suggested' (saved from an agent suggestion). */
    source: text('source').notNull().default('user'),
    /** Comma-separated trigger keywords; matching prompts inject the note at send time. */
    triggers: text('triggers'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('knowledge_notes_project_idx').on(t.projectId)]
)

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
