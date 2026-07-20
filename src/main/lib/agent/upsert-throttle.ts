/**
 * Per-message-id leading+trailing throttle for `message-upsert` UI events.
 * Streaming deltas (tool input, shell output) emit a full-message snapshot on
 * every SDK event; since upserts are idempotent snapshots, intermediate ones
 * can be dropped losslessly. The leading edge keeps streaming feeling
 * instant, the trailing edge guarantees the final snapshot always lands.
 * All other event types pass through synchronously; a `messages-reset` drops
 * pending upserts so a stale snapshot can't resurrect truncated history.
 */
import type { AgentUIEvent } from '../../../shared/ui-message'

interface ThrottleState {
  lastEmit: number
  timer: NodeJS.Timeout | null
  latest: AgentUIEvent | null
}

export function createUpsertThrottle(
  emit: (ev: AgentUIEvent) => void,
  intervalMs = 50
): { emit: (ev: AgentUIEvent) => void; dispose: () => void } {
  const perMessage = new Map<string, ThrottleState>()
  let disposed = false

  const clearPending = (): void => {
    for (const st of perMessage.values()) {
      if (st.timer) clearTimeout(st.timer)
    }
    perMessage.clear()
  }

  return {
    emit(ev: AgentUIEvent): void {
      if (disposed) return
      if (ev.type !== 'message-upsert') {
        if (ev.type === 'messages-reset') clearPending()
        emit(ev)
        return
      }
      const id = ev.message.id
      let st = perMessage.get(id)
      if (!st) {
        st = { lastEmit: 0, timer: null, latest: null }
        perMessage.set(id, st)
      }
      const now = Date.now()
      if (st.timer === null && now - st.lastEmit >= intervalMs) {
        st.lastEmit = now
        emit(ev)
        return
      }
      st.latest = ev
      if (st.timer === null) {
        const state = st
        const timer = setTimeout(
          () => {
            state.timer = null
            const latest = state.latest
            state.latest = null
            if (latest && !disposed) {
              state.lastEmit = Date.now()
              emit(latest)
            }
          },
          Math.max(0, intervalMs - (now - st.lastEmit))
        )
        timer.unref?.()
        st.timer = timer
      }
    },
    dispose(): void {
      disposed = true
      clearPending()
    }
  }
}
