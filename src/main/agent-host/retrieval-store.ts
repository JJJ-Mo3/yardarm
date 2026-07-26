/**
 * Bounded in-memory store of original tool outputs that prompt compression
 * rewrote, keyed by toolCallId — the backing store for the
 * retrieve_full_output tool (Headroom's reversible-compression analog).
 *
 * Entries are re-put on every LLM step for as long as their part is still
 * being compressed, so eviction (oldest-first once over the count/byte caps)
 * naturally drops outputs that left the context window. Pure and
 * dependency-free so it is unit-testable.
 */

export interface RetrievalStoreOptions {
  /** Maximum number of entries kept. */
  maxEntries: number
  /** Maximum total UTF-16 code units across all entries. */
  maxBytes: number
}

export interface RetrievalEntry {
  toolName: string
  text: string
}

export interface RetrievalStore {
  put: (toolCallId: string, toolName: string, text: string) => void
  get: (toolCallId: string) => RetrievalEntry | undefined
  size: () => number
}

export function createRetrievalStore(opts: RetrievalStoreOptions): RetrievalStore {
  const entries = new Map<string, RetrievalEntry>()
  let totalBytes = 0
  // Oversized single outputs can never fit; don't let them purge the store.
  const perEntryCap = Math.max(1, Math.floor(opts.maxBytes / 4))

  const evict = (): void => {
    for (const [key, entry] of entries) {
      if (entries.size <= opts.maxEntries && totalBytes <= opts.maxBytes) break
      entries.delete(key)
      totalBytes -= entry.text.length
    }
  }

  return {
    put: (toolCallId, toolName, text) => {
      if (text.length > perEntryCap) return
      const existing = entries.get(toolCallId)
      if (existing) {
        // Refresh recency (Map iteration order = insertion order) so entries
        // still in the compressed window outlive ones that fell out of it.
        entries.delete(toolCallId)
        totalBytes -= existing.text.length
      }
      entries.set(toolCallId, { toolName, text })
      totalBytes += text.length
      evict()
    },
    get: (toolCallId) => entries.get(toolCallId),
    size: () => entries.size
  }
}
