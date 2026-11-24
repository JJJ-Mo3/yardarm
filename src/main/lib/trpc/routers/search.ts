/**
 * Search router: full-text search over message text across all chats, backed
 * by the FTS5 index in ../../db/message-search.ts. The first query starts the
 * chunked backfill of messages that predate the index; `indexing` tells the
 * renderer results may still be partial.
 */
import { z } from 'zod'
import { SEARCH_MAX_INPUT } from '@shared/message-search'
import { ensureSearchBackfill, searchMessages } from '../../db/message-search'
import { publicProcedure, router } from '../trpc'

export const searchRouter = router({
  messages: publicProcedure
    .input(
      z.object({
        query: z.string().max(SEARCH_MAX_INPUT),
        limit: z.number().int().min(1).max(100).default(40)
      })
    )
    .query(({ input }) => {
      const indexing = ensureSearchBackfill()
      return { hits: searchMessages(input.query, input.limit), indexing }
    })
})
