/**
 * Dock badge (macOS; no-op where unsupported): count of chats needing
 * attention — awaiting an approval or holding an unread finished reply.
 * Debounced, change-only mutations; sends 0 on the first settle so a stale
 * badge from a previous app run clears.
 */
import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { trpc } from './trpc'
import { chatStatusesAtom, unseenChatsAtom } from './atoms'

export function useAttentionBadge(): void {
  const chatStatuses = useAtomValue(chatStatusesAtom)
  const unseenChats = useAtomValue(unseenChatsAtom)
  const setBadge = trpc.system.setBadgeCount.useMutation()
  const lastSent = useRef<number | null>(null)

  // Union: a chat that is both awaiting and unseen counts once.
  const ids = new Set(unseenChats)
  for (const [chatId, s] of chatStatuses) if (s.awaiting) ids.add(chatId)
  const count = ids.size

  const mutate = setBadge.mutate
  useEffect(() => {
    if (lastSent.current === count) return
    const t = setTimeout(() => {
      lastSent.current = count
      mutate({ count })
    }, 300)
    return () => clearTimeout(t)
  }, [count, mutate])
}
