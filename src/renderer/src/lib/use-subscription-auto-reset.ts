/**
 * Self-healing for long-lived tRPC subscriptions. tRPC's useSubscription does
 * NOT resubscribe after an error or completion — it parks in status 'error'
 * (or 'idle') forever, so a single hiccup in the IPC stream silently freezes
 * every consumer until the component remounts (e.g. the user re-selects the
 * chat in the sidebar). This hook watches the subscription result and calls
 * its reset() after a short delay whenever it dies while it should be live;
 * the fresh subscription re-runs the server-side seeding, restoring state.
 */
import { useEffect } from 'react'

export function useSubscriptionAutoReset(
  sub: { status: 'idle' | 'connecting' | 'pending' | 'error'; reset: () => void },
  enabled: boolean
): void {
  const { status, reset } = sub
  // 'idle' while enabled means the stream completed; 'error' means it failed.
  // Both are terminal without a reset. The delay debounces transient states
  // and keeps a persistently-failing stream from busy-looping.
  const dead = enabled && (status === 'error' || status === 'idle')
  useEffect(() => {
    if (!dead) return
    const timer = setTimeout(reset, 1500)
    return () => clearTimeout(timer)
  }, [dead, reset])
}
