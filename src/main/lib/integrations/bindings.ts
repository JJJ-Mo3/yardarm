/**
 * Conversation-binding persistence for remote messaging integrations: CRUD
 * over the integration_bindings table plus name-substring resolution of
 * projects and chats for the `use` / `chats` / `new` bot commands. One
 * binding per (platform, conversation) — rebinding upserts.
 */
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { IntegrationBindingInfo, IntegrationPlatform } from '../../../shared/integrations'

export interface BindingRow {
  id: string
  platform: string
  conversationId: string
  projectId: string
  chatId: string
  subchatId: string
  createdAt: number
  updatedAt: number
}

// ---- Pure name resolution (unit-tested without a DB) ------------------------

export type NameMatch<T> = { ok: T } | { error: string }

/**
 * Resolve a user-typed name against a list: exact (case-insensitive) match
 * wins, otherwise a unique substring match; anything else is a helpful error.
 */
export function resolveByName<T extends { name: string }>(
  items: T[],
  query: string,
  noun: string
): NameMatch<T> {
  const q = query.trim().toLowerCase()
  if (!q) return { error: `No ${noun} name given.` }
  const exact = items.filter((i) => i.name.toLowerCase() === q)
  if (exact.length === 1) return { ok: exact[0] }
  const partial = items.filter((i) => i.name.toLowerCase().includes(q))
  if (partial.length === 1) return { ok: partial[0] }
  if (partial.length === 0) return { error: `No ${noun} matching "${query}".` }
  const names = partial
    .slice(0, 8)
    .map((i) => i.name)
    .join(', ')
  return { error: `"${query}" matches ${partial.length} ${noun}s: ${names}. Be more specific.` }
}

// ---- DB access --------------------------------------------------------------

export function listProjects(): Array<{ id: string; name: string }> {
  return getDb()
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.archived, false))
    .orderBy(asc(schema.projects.name))
    .all()
}

export function listChats(projectId: string): Array<{ id: string; name: string }> {
  return getDb()
    .select({ id: schema.chats.id, name: schema.chats.title })
    .from(schema.chats)
    .where(
      and(
        eq(schema.chats.projectId, projectId),
        eq(schema.chats.archived, false),
        eq(schema.chats.hidden, false)
      )
    )
    .orderBy(asc(schema.chats.title))
    .all()
}

/** Earliest subchat of a chat (the primary conversation tab). */
export function firstSubchatId(chatId: string): string | null {
  const row = getDb()
    .select({ id: schema.subchats.id })
    .from(schema.subchats)
    .where(eq(schema.subchats.chatId, chatId))
    .orderBy(asc(schema.subchats.createdAt))
    .get()
  return row?.id ?? null
}

export function getBinding(
  platform: IntegrationPlatform,
  conversationId: string
): BindingRow | null {
  return (
    getDb()
      .select()
      .from(schema.integrationBindings)
      .where(
        and(
          eq(schema.integrationBindings.platform, platform),
          eq(schema.integrationBindings.conversationId, conversationId)
        )
      )
      .get() ?? null
  )
}

/** All bindings pointing at one subchat (outbound relay fan-out). */
export function bindingsForSubchat(subchatId: string): BindingRow[] {
  return getDb()
    .select()
    .from(schema.integrationBindings)
    .where(eq(schema.integrationBindings.subchatId, subchatId))
    .all()
}

/** Every bound subchat id (relay subscription rebuild). */
export function allBoundSubchatIds(): string[] {
  const rows = getDb()
    .select({ subchatId: schema.integrationBindings.subchatId })
    .from(schema.integrationBindings)
    .all()
  return [...new Set(rows.map((r) => r.subchatId))]
}

/** Bind a conversation to a chat, replacing any existing binding. */
export function setBinding(input: {
  platform: IntegrationPlatform
  conversationId: string
  projectId: string
  chatId: string
  subchatId: string
}): BindingRow {
  const db = getDb()
  const now = Date.now()
  const existing = getBinding(input.platform, input.conversationId)
  if (existing) {
    db.update(schema.integrationBindings)
      .set({
        projectId: input.projectId,
        chatId: input.chatId,
        subchatId: input.subchatId,
        updatedAt: now
      })
      .where(eq(schema.integrationBindings.id, existing.id))
      .run()
    return { ...existing, ...input, updatedAt: now }
  }
  const row: BindingRow = { id: randomUUID(), ...input, createdAt: now, updatedAt: now }
  db.insert(schema.integrationBindings).values(row).run()
  return row
}

export function deleteBindingByConversation(
  platform: IntegrationPlatform,
  conversationId: string
): boolean {
  const existing = getBinding(platform, conversationId)
  if (!existing) return false
  getDb()
    .delete(schema.integrationBindings)
    .where(eq(schema.integrationBindings.id, existing.id))
    .run()
  return true
}

export function deleteBindingById(id: string): void {
  getDb().delete(schema.integrationBindings).where(eq(schema.integrationBindings.id, id)).run()
}

/** Bindings joined with project/chat names for the settings UI. */
export function listBindingsInfo(): IntegrationBindingInfo[] {
  const rows = getDb()
    .select({
      id: schema.integrationBindings.id,
      platform: schema.integrationBindings.platform,
      conversationId: schema.integrationBindings.conversationId,
      projectId: schema.integrationBindings.projectId,
      projectName: schema.projects.name,
      chatId: schema.integrationBindings.chatId,
      chatTitle: schema.chats.title,
      subchatId: schema.integrationBindings.subchatId,
      createdAt: schema.integrationBindings.createdAt,
      updatedAt: schema.integrationBindings.updatedAt
    })
    .from(schema.integrationBindings)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.integrationBindings.projectId))
    .innerJoin(schema.chats, eq(schema.chats.id, schema.integrationBindings.chatId))
    .all()
  return rows.map((r) => ({ ...r, platform: r.platform as IntegrationPlatform }))
}
