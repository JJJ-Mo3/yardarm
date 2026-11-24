/**
 * Thin bar shown at the top of a chat that belongs to a model comparison
 * (/compare) while other chats of that comparison are still open: "Keep this
 * one" archives the others — after a confirmation, and never deleting them —
 * and closes the split panes that were showing them.
 */
import React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Columns3 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { selectedChatIdAtom, selectedSubchatIdAtom, splitPanesAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'

export function CompareKeepBar({ subchatId }: { subchatId: string }): React.JSX.Element | null {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const [selectedChatId, setSelectedChatId] = useAtom(selectedChatIdAtom)
  const setSelectedSubchatId = useSetAtom(selectedSubchatIdAtom)
  const setSplitPanes = useSetAtom(splitPanesAtom)
  const group = trpc.compare.group.useQuery({ subchatId }, { staleTime: 10_000 })
  const keep = trpc.compare.keep.useMutation({
    onSuccess: async (res) => {
      const archived = new Set(res.archivedChatIds)
      // The kept chat becomes the primary pane when the primary one was
      // archived; panes showing archived chats (or the kept chat twice) close.
      if (selectedChatId && archived.has(selectedChatId)) {
        setSelectedChatId(res.keptChatId)
        setSelectedSubchatId(subchatId)
      }
      setSplitPanes((panes) =>
        panes.filter((p) => !p.chatId || (!archived.has(p.chatId) && p.chatId !== res.keptChatId))
      )
      await Promise.all([utils.chats.list.invalidate(), utils.compare.group.invalidate()])
    }
  })

  const data = group.data
  if (!data) return null
  const n = data.others.length

  const onKeep = (): void => {
    void confirmDialog({
      title: 'Keep this chat and archive the others?',
      description:
        `The other ${n === 1 ? 'chat' : `${n} chats`} of this comparison will be archived and ` +
        `${n === 1 ? 'its agent' : 'their agents'} stopped:\n\n` +
        data.others.map((o) => `• ${o.title}`).join('\n') +
        '\n\nNothing is deleted — archived chats keep their worktree and transcript and can be ' +
        'restored from the sidebar.',
      confirmLabel: 'Keep this one',
      destructive: false
    }).then((ok) => {
      if (ok) keep.mutate({ chatId: data.chatId })
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-sky-500/5 px-3 py-1 text-[11px]">
      <Columns3 size={12} className="shrink-0 text-sky-500" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        Model comparison — {n} other chat{n === 1 ? '' : 's'} ran the same prompt
      </span>
      {keep.error && (
        <span className="selectable text-xs text-destructive">
          Keep failed: {keep.error.message}
        </span>
      )}
      <Tip content="Keep this chat and archive the other chats of this comparison (asks first; nothing is deleted)">
        <span className="inline-flex shrink-0">
          <Button size="sm" variant="outline" disabled={keep.isPending} onClick={onKeep}>
            Keep this one
          </Button>
        </span>
      </Tip>
    </div>
  )
}
