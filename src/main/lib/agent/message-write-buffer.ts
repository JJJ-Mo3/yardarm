/**
 * Coalesces high-frequency message persists behind a short trailing debounce.
 * Long agent turns re-persist the whole (growing) message once per tool call;
 * buffering keeps only the latest snapshot per message id so the SQLite row
 * is rewritten a handful of times instead of dozens. Finality-sensitive
 * writes (user messages, message_end) bypass the debounce via `flush: true`,
 * and owners flush on host stop/exit/shutdown so at most ~delayMs of one
 * in-flight message can be lost on a hard crash.
 */
import type { StoredMessage } from '../../../shared/ui-message'

interface PendingWrite {
  subchatId: string
  message: StoredMessage
  timer: NodeJS.Timeout
}

export class MessageWriteBuffer {
  private pending = new Map<string, PendingWrite>()

  constructor(
    private write: (subchatId: string, message: StoredMessage) => void,
    private delayMs = 400
  ) {}

  /** Queue (or with `flush` immediately perform) a write of the snapshot. */
  enqueue(subchatId: string, message: StoredMessage, opts?: { flush?: boolean }): void {
    const existing = this.pending.get(message.id)
    if (existing) clearTimeout(existing.timer)
    if (opts?.flush) {
      this.pending.delete(message.id)
      this.safeWrite(subchatId, message)
      return
    }
    const timer = setTimeout(() => {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      this.safeWrite(entry.subchatId, entry.message)
    }, this.delayMs)
    timer.unref?.()
    this.pending.set(message.id, { subchatId, message, timer })
  }

  /** Write out pending snapshots now — for one subchat, or all of them. */
  flush(subchatId?: string): void {
    for (const [id, entry] of [...this.pending]) {
      if (subchatId !== undefined && entry.subchatId !== subchatId) continue
      clearTimeout(entry.timer)
      this.pending.delete(id)
      this.safeWrite(entry.subchatId, entry.message)
    }
  }

  private safeWrite(subchatId: string, message: StoredMessage): void {
    try {
      this.write(subchatId, message)
    } catch (err) {
      console.error('[message-write-buffer] write failed', err)
    }
  }
}
