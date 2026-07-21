/**
 * Per-subchat FIFO of prompts submitted while the agent is running. Items are
 * held in main-process memory (they survive renderer reloads and host
 * restarts, not app restarts) and flushed one at a time by the session
 * manager when a run ends. File payloads (base64) never leave this queue —
 * the renderer only sees QueuedPromptInfo snapshots.
 */
import { randomUUID } from 'node:crypto'
import type { FileAttachment } from '../../../shared/ipc-types'
import type { QueuedPromptInfo } from '../../../shared/ui-message'

export interface QueuedPrompt {
  id: string
  text: string
  files?: FileAttachment[]
  createdAt: number
}

export class PromptQueue {
  private queues = new Map<string, QueuedPrompt[]>()

  private itemsFor(subchatId: string): QueuedPrompt[] {
    let items = this.queues.get(subchatId)
    if (!items) {
      items = []
      this.queues.set(subchatId, items)
    }
    return items
  }

  enqueue(subchatId: string, text: string, files?: FileAttachment[]): QueuedPrompt {
    const item: QueuedPrompt = {
      id: randomUUID(),
      text,
      files: files?.length ? files : undefined,
      createdAt: Date.now()
    }
    this.itemsFor(subchatId).push(item)
    return item
  }

  /** Remove one item by id; returns whether anything was removed. */
  dismiss(subchatId: string, id: string): boolean {
    const items = this.queues.get(subchatId)
    if (!items) return false
    const idx = items.findIndex((i) => i.id === id)
    if (idx < 0) return false
    items.splice(idx, 1)
    return true
  }

  /** Take the head item off the queue (next to send), if any. */
  shift(subchatId: string): QueuedPrompt | undefined {
    return this.queues.get(subchatId)?.shift()
  }

  /** Put an item back at the front (failed send). */
  unshift(subchatId: string, item: QueuedPrompt): void {
    this.itemsFor(subchatId).unshift(item)
  }

  size(subchatId: string): number {
    return this.queues.get(subchatId)?.length ?? 0
  }

  /** Renderer-safe snapshot: text + attachment count only, no file payloads. */
  list(subchatId: string): QueuedPromptInfo[] {
    return (this.queues.get(subchatId) ?? []).map((i) => ({
      id: i.id,
      text: i.text,
      fileCount: i.files?.length ?? 0,
      createdAt: i.createdAt
    }))
  }
}
