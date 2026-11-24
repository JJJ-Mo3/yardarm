/**
 * `yardarm://new` deep links, renderer side (mounted once in App). The main
 * process validates each link and raises system.deepLinkSignal; this hook
 * collects it with system.takeDeepLink, selects the named project (exact,
 * case-insensitive name match) and opens the new-chat dialog with the link's
 * prompt held as a prefill. Nothing here creates a chat, sends a prompt or
 * changes a setting — the user confirms in the dialog, and the prompt lands
 * in the composer as an unsent draft. Unknown projects and invalid links only
 * show a message.
 */
import { useRef } from 'react'
import { useSetAtom, useStore } from 'jotai'
import { findProjectByName } from '@shared/deep-link'
import { trpc } from '../../lib/trpc'
import {
  deepLinkPrefillAtom,
  mainTabAtom,
  newChatOpenAtom,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom
} from '../../lib/atoms'
import { useConfirm } from '../../components/ConfirmDialog'

/** A window that isn't focused waits this long so the focused one collects the link first. */
const UNFOCUSED_DELAY_MS = 400

export function useDeepLinks(): void {
  const store = useStore()
  const setProjectId = useSetAtom(selectedProjectIdAtom)
  const setChatId = useSetAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const setTab = useSetAtom(mainTabAtom)
  const setNewChatOpen = useSetAtom(newChatOpenAtom)
  const setPrefill = useSetAtom(deepLinkPrefillAtom)
  const confirm = useConfirm()
  const utils = trpc.useUtils()
  const take = trpc.system.takeDeepLink.useMutation()

  const notify = (title: string, description: string): void => {
    void confirm({ title, description, confirmLabel: 'OK', destructive: false })
  }

  const collect = async (): Promise<void> => {
    const link = await take.mutateAsync()
    if (!link) return // another window collected it
    if (!link.ok) {
      notify('Link not opened', `${link.error} Nothing was changed.`)
      return
    }
    const { project, prompt } = link.request
    const projects = await utils.projects.list.fetch()
    let targetId = store.get(selectedProjectIdAtom)
    if (project) {
      const match = findProjectByName(projects, project)
      if (!match) {
        notify(
          'Project not found',
          `The link asked for a project named "${project}", but no project with that name ` +
            'exists in Yardarm. Nothing was changed.'
        )
        return
      }
      targetId = match.id
    } else if (!targetId || !projects.some((p) => p.id === targetId)) {
      notify(
        'No project selected',
        'The link did not name a project and none is selected. Select a project and open the ' +
          'link again. Nothing was changed.'
      )
      return
    }
    if (targetId !== store.get(selectedProjectIdAtom)) {
      // Same as the sidebar picker: the old project's chat must not leak over.
      setChatId(null)
      setSubchatId(null)
      setProjectId(targetId)
    }
    setTab('chat')
    setPrefill(prompt)
    setNewChatOpen(true)
  }

  const collectRef = useRef(collect)
  collectRef.current = collect

  trpc.system.deepLinkSignal.useSubscription(undefined, {
    onData: () => {
      const run = (): void => {
        collectRef.current().catch((err: unknown) => {
          notify('Link not opened', err instanceof Error ? err.message : String(err))
        })
      }
      if (document.hasFocus()) run()
      else setTimeout(run, UNFOCUSED_DELAY_MS)
    },
    onError: (err) => console.error('system.deepLinkSignal subscription error:', err)
  })
}
