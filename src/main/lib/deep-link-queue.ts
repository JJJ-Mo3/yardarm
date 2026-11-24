/**
 * Holds the most recent parsed deep link until a renderer collects it (pure,
 * unit-tested). Links can arrive before any window exists — at launch, or on
 * macOS with every window closed — so the last one is queued and a signal is
 * raised; a renderer answers the signal (or checks on subscribe) by calling
 * `take()`, which hands the link to exactly one window and clears it. A newer
 * link replaces an uncollected older one: only the last is kept.
 */
import type { DeepLinkResult } from '../../shared/deep-link'

export class DeepLinkQueue {
  private pending: DeepLinkResult | null = null
  private listeners = new Set<() => void>()

  /** Queue a parsed link (replacing any uncollected one) and signal listeners. */
  put(result: DeepLinkResult): void {
    this.pending = result
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // a broken subscriber must not block the others
      }
    }
  }

  /** Whether a link is waiting to be collected. */
  hasPending(): boolean {
    return this.pending !== null
  }

  /** Collect the waiting link, if any. Each link is returned exactly once. */
  take(): DeepLinkResult | null {
    const result = this.pending
    this.pending = null
    return result
  }

  /** Subscribe to "a link is waiting" signals; returns the unsubscriber. */
  onSignal(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
