/**
 * Focus-chat requests from clicked desktop notifications, mounted once in
 * App: selects the source chat and subchat, switches to the chat tab, and
 * corrects the selected project when the chat lives in a different one.
 */
import { useSetAtom } from 'jotai'
import { trpc } from '../../lib/trpc'
import {
  mainTabAtom,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom
} from '../../lib/atoms'

export function useNotificationFocus(): void {
  const setProjectId = useSetAtom(selectedProjectIdAtom)
  const setChatId = useSetAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const setTab = useSetAtom(mainTabAtom)
  const utils = trpc.useUtils()

  trpc.agent.focusRequests.useSubscription(undefined, {
    onData: (req) => {
      setChatId(req.chatId)
      setSubchatId(req.subchatId)
      setTab('chat')
      // Align the sidebar's project selection with the chat (best-effort).
      utils.chats.get
        .fetch({ id: req.chatId })
        .then((chat) => {
          if (chat) setProjectId(chat.projectId)
        })
        .catch(() => {})
    },
    onError: (err) => console.error('agent.focusRequests subscription error:', err)
  })
}
