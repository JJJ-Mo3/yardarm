/**
 * Open any chat from a cross-project surface (inbox, cross-chat search):
 * switch the selected project when the chat lives in another one, select the
 * chat (and the given subchat, or its first one), and show the Chat tab.
 */
import { useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { trpc } from './trpc'
import {
  mainTabAtom,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom
} from './atoms'

export interface OpenChatTarget {
  projectId: string
  chatId: string
  /** Conversation tab to show; defaults to the chat's first subchat. */
  subchatId?: string | null
}

export function useOpenChat(): (target: OpenChatTarget) => void {
  const [projectId, setProjectId] = useAtom(selectedProjectIdAtom)
  const setChatId = useSetAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const setTab = useSetAtom(mainTabAtom)
  const utils = trpc.useUtils()
  return useCallback(
    (target: OpenChatTarget) => {
      if (target.projectId !== projectId) setProjectId(target.projectId)
      setChatId(target.chatId)
      setSubchatId(target.subchatId ?? null)
      setTab('chat')
      if (!target.subchatId) {
        utils.chats.get
          .fetch({ id: target.chatId })
          .then((chat) => setSubchatId(chat?.subchats[0]?.id ?? null))
          .catch(() => {})
      }
    },
    [projectId, setProjectId, setChatId, setSubchatId, setTab, utils]
  )
}
