/**
 * Global chat-status tracker, mounted once in App. Subscribes to the
 * agent.statusAll stream (all subchats, not just the open one), mirrors it
 * into subchatStatusesAtom for the sidebar indicators, and maintains
 * unseenChatsAtom: a chat is flagged when its last run finishes while it
 * isn't selected, and unflagged when the user selects it.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { trpc } from '../../lib/trpc'
import { selectedChatIdAtom, subchatStatusesAtom, unseenChatsAtom } from '../../lib/atoms'
import type { SubchatStatusInfo } from '../../../../shared/ui-message'

export function useChatStatusTracker(): void {
  const setStatuses = useSetAtom(subchatStatusesAtom)
  const setUnseen = useSetAtom(unseenChatsAtom)
  const selectedChatId = useAtomValue(selectedChatIdAtom)

  // Refs so onData stays stable while reading fresh values.
  const selectedRef = useRef(selectedChatId)
  selectedRef.current = selectedChatId
  const statusesRef = useRef(new Map<string, SubchatStatusInfo>())
  const runningByChatRef = useRef(new Map<string, boolean>())

  const onData = useCallback(
    (info: SubchatStatusInfo) => {
      const next = new Map(statusesRef.current)
      next.set(info.subchatId, info)
      statusesRef.current = next
      setStatuses(next)

      // Chat-level running aggregate across the chat's subchats.
      let chatRunning = false
      for (const s of next.values()) {
        if (s.chatId === info.chatId && s.running) chatRunning = true
      }
      const wasRunning = runningByChatRef.current.get(info.chatId) ?? false
      runningByChatRef.current.set(info.chatId, chatRunning)
      if (wasRunning && !chatRunning && selectedRef.current !== info.chatId) {
        setUnseen((prev) => new Set(prev).add(info.chatId))
      }
    },
    [setStatuses, setUnseen]
  )

  trpc.agent.statusAll.useSubscription(undefined, { onData })

  // Selecting a chat marks it seen.
  useEffect(() => {
    if (!selectedChatId) return
    setUnseen((prev) => {
      if (!prev.has(selectedChatId)) return prev
      const next = new Set(prev)
      next.delete(selectedChatId)
      return next
    })
  }, [selectedChatId, setUnseen])
}
