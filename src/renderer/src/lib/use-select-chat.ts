/**
 * Shared chat-selection behavior (Sidebar rows, Kanban cards): select the
 * chat, clear the subchat immediately so the previous chat's subchat never
 * renders against the new chat's cwd while the fetch is in flight, then load
 * the chat's first subchat.
 */
import { useCallback } from 'react'
import { useSetAtom } from 'jotai'
import { trpc } from './trpc'
import { selectedChatIdAtom, selectedSubchatIdAtom } from './atoms'

export function useSelectChat(): (id: string) => void {
  const setChatId = useSetAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const utils = trpc.useUtils()
  return useCallback(
    (id: string) => {
      setChatId(id)
      setSubchatId(null)
      utils.chats.get.fetch({ id }).then((chat) => {
        setSubchatId(chat?.subchats[0]?.id ?? null)
      })
    },
    [setChatId, setSubchatId, utils]
  )
}
