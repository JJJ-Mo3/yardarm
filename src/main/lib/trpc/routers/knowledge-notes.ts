/**
 * User-authored knowledge notes CRUD (Devin-style Knowledge). Rows live in
 * the app DB per project; pinned note bodies are inlined into the system
 * prompt at host boot, the rest are indexed by title and fetched on demand
 * via the auto-approved knowledge_note_lookup tool. Distinct from the SDK's
 * experimental knowledge base (agent memory browsed by KnowledgeDialog).
 * Edits apply at the next host boot, so mutations restart the project's
 * running hosts (same convention as subagent/MCP config edits).
 */
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { MAX_NOTES, MAX_NOTE_BODY_CHARS, MAX_NOTE_TITLE_CHARS } from '@shared/knowledge-notes'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { getDb, schema } from '../../db'
import { publicProcedure, router } from '../trpc'

const titleSchema = z.string().min(1).max(MAX_NOTE_TITLE_CHARS)
const bodySchema = z.string().min(1).max(MAX_NOTE_BODY_CHARS)

export const knowledgeNotesRouter = router({
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
    return getDb()
      .select()
      .from(schema.knowledgeNotes)
      .where(eq(schema.knowledgeNotes.projectId, input.projectId))
      .orderBy(asc(schema.knowledgeNotes.createdAt))
      .all()
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        projectPath: z.string(),
        title: titleSchema,
        body: bodySchema,
        pinned: z.boolean().default(false),
        source: z.enum(['user', 'suggested']).default('user')
      })
    )
    .mutation(({ input }) => {
      const db = getDb()
      const count = db
        .select({ id: schema.knowledgeNotes.id })
        .from(schema.knowledgeNotes)
        .where(eq(schema.knowledgeNotes.projectId, input.projectId))
        .all().length
      if (count >= MAX_NOTES) {
        throw new Error(
          `This project already has ${MAX_NOTES} knowledge notes — delete one before adding more.`
        )
      }
      const now = Date.now()
      const row = {
        id: randomUUID(),
        projectId: input.projectId,
        title: input.title,
        body: input.body,
        pinned: input.pinned,
        enabled: true,
        source: input.source,
        createdAt: now,
        updatedAt: now
      }
      db.insert(schema.knowledgeNotes).values(row).run()
      agentSessionManager.restartByProject(input.projectPath)
      return row
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        projectPath: z.string(),
        title: titleSchema,
        body: bodySchema,
        pinned: z.boolean(),
        enabled: z.boolean()
      })
    )
    .mutation(({ input }) => {
      const db = getDb()
      const row = db
        .select()
        .from(schema.knowledgeNotes)
        .where(eq(schema.knowledgeNotes.id, input.id))
        .get()
      if (!row) throw new Error('Knowledge note not found')
      db.update(schema.knowledgeNotes)
        .set({
          title: input.title,
          body: input.body,
          pinned: input.pinned,
          enabled: input.enabled,
          updatedAt: Date.now()
        })
        .where(eq(schema.knowledgeNotes.id, input.id))
        .run()
      agentSessionManager.restartByProject(input.projectPath)
      return { ok: true }
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string(), projectPath: z.string() }))
    .mutation(({ input }) => {
      getDb().delete(schema.knowledgeNotes).where(eq(schema.knowledgeNotes.id, input.id)).run()
      agentSessionManager.restartByProject(input.projectPath)
      return { ok: true }
    })
})
