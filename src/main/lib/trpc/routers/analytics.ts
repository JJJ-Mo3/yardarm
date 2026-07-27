/**
 * Token-usage analytics aggregated from persisted messages.
 * Per-message usage and model attribution exist from migration v6 onward, so
 * older messages show up in counts but not in token totals.
 */
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db'
import { publicProcedure, router } from '../trpc'
import { buildUsageCsv, type UsageCsvRow } from '../../analytics/usage-csv'

const rangeInput = z.object({
  projectId: z.string(),
  days: z.number().int().positive().max(365).default(30)
})

function sinceMs(days: number): number {
  return Date.now() - days * 86_400_000
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export const analyticsRouter = router({
  usageByDay: publicProcedure.input(rangeInput).query(({ input }) => {
    return getDb().all<UsageTotals & { day: string }>(sql`
      select date(m.created_at / 1000, 'unixepoch', 'localtime') as day,
             coalesce(sum(json_extract(m.usage, '$.inputTokens')), 0) as inputTokens,
             coalesce(sum(json_extract(m.usage, '$.outputTokens')), 0) as outputTokens,
             coalesce(sum(json_extract(m.usage, '$.totalTokens')), 0) as totalTokens
      from messages m
      join subchats s on s.id = m.subchat_id
      join chats c on c.id = s.chat_id
      where c.project_id = ${input.projectId}
        and m.usage is not null
        and m.created_at >= ${sinceMs(input.days)}
      group by day
      order by day
    `)
  }),

  usageByModel: publicProcedure.input(rangeInput).query(({ input }) => {
    return getDb().all<UsageTotals & { modelId: string; messages: number }>(sql`
      select coalesce(m.model_id, s.model_id, '(unknown)') as modelId,
             count(*) as messages,
             coalesce(sum(json_extract(m.usage, '$.inputTokens')), 0) as inputTokens,
             coalesce(sum(json_extract(m.usage, '$.outputTokens')), 0) as outputTokens,
             coalesce(sum(json_extract(m.usage, '$.totalTokens')), 0) as totalTokens
      from messages m
      join subchats s on s.id = m.subchat_id
      join chats c on c.id = s.chat_id
      where c.project_id = ${input.projectId}
        and m.usage is not null
        and m.created_at >= ${sinceMs(input.days)}
      group by 1
      order by totalTokens desc
    `)
  }),

  usageByChat: publicProcedure.input(rangeInput).query(({ input }) => {
    return getDb().all<UsageTotals & { chatId: string; title: string }>(sql`
      select c.id as chatId,
             c.title as title,
             coalesce(sum(json_extract(m.usage, '$.inputTokens')), 0) as inputTokens,
             coalesce(sum(json_extract(m.usage, '$.outputTokens')), 0) as outputTokens,
             coalesce(sum(json_extract(m.usage, '$.totalTokens')), 0) as totalTokens
      from messages m
      join subchats s on s.id = m.subchat_id
      join chats c on c.id = s.chat_id
      where c.project_id = ${input.projectId}
        and m.usage is not null
        and m.created_at >= ${sinceMs(input.days)}
      group by c.id
      order by totalTokens desc
      limit 30
    `)
  }),

  compressionSavings: publicProcedure.input(rangeInput).query(({ input }) => {
    const row = getDb().get<{ tokensSaved: number }>(sql`
      select coalesce(sum(e.tokens_saved), 0) as tokensSaved
      from compression_events e
      join subchats s on s.id = e.subchat_id
      join chats c on c.id = s.chat_id
      where c.project_id = ${input.projectId}
        and e.created_at >= ${sinceMs(input.days)}
    `)
    return { tokensSaved: row?.tokensSaved ?? 0 }
  }),

  exportCsv: publicProcedure.input(rangeInput).query(({ input }) => {
    const rows = getDb().all<UsageCsvRow>(sql`
      select date(m.created_at / 1000, 'unixepoch', 'localtime') as day,
             coalesce(m.model_id, s.model_id, '(unknown)') as modelId,
             coalesce(sum(json_extract(m.usage, '$.inputTokens')), 0) as inputTokens,
             coalesce(sum(json_extract(m.usage, '$.outputTokens')), 0) as outputTokens,
             coalesce(sum(json_extract(m.usage, '$.totalTokens')), 0) as totalTokens
      from messages m
      join subchats s on s.id = m.subchat_id
      join chats c on c.id = s.chat_id
      where c.project_id = ${input.projectId}
        and m.usage is not null
        and m.created_at >= ${sinceMs(input.days)}
      group by day, modelId
      order by day, modelId
    `)
    return buildUsageCsv(rows)
  })
})
