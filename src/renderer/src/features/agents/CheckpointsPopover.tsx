/**
 * Header popover listing this chat's rollback checkpoints (named + auto git
 * snapshots under refs/yardarm/checkpoints). Read-only: restoring stays on the
 * message rollback path; the footer deep-links to the Changes tab's checkpoint
 * manager pane for compare/prune.
 */
import React from 'react'
import { History } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { trpc } from '../../lib/trpc'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Tip } from '../../components/ui/tooltip'
import { Button } from '../../components/ui/button'
import { timeAgo } from '../../lib/utils'
import { changesPaneRequestAtom, mainTabAtom, selectedChatIdAtom } from '../../lib/atoms'

export function CheckpointsPopover({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const chatId = useAtomValue(selectedChatIdAtom)
  const setMainTab = useSetAtom(mainTabAtom)
  const setPaneRequest = useSetAtom(changesPaneRequestAtom)
  // Refetch while open so checkpoints captured by an active run show live.
  const list = trpc.checkpoints.list.useQuery(
    { chatId: chatId ?? '' },
    { enabled: open && !!chatId, refetchInterval: 8000, retry: false }
  )

  const openInChanges = (): void => {
    setPaneRequest('checkpoints')
    setMainTab('changes')
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tip content="Rollback checkpoints for this chat (named + auto snapshots)" side="bottom">
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer">
            <History size={11} />
            checkpoints
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-1.5 text-xs font-medium">Checkpoints</div>
        {list.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
        {list.error && (
          <div className="text-[11px] text-red-500">
            Failed to load checkpoints: {list.error.message}
          </div>
        )}
        {list.data && list.data.length === 0 && (
          <div className="text-[11px] text-muted-foreground">
            No checkpoints yet. Auto snapshots are captured as the agent makes changes; create named
            ones in the Changes tab.
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {list.data.map((ck) => (
              <div key={ck.id} className="rounded border border-border px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium" title={ck.name ?? ck.headSha}>
                    {ck.name ?? ck.headSha.slice(0, 7)}
                  </span>
                  <span className="shrink-0 rounded bg-secondary px-1 py-px text-[10px] text-muted-foreground">
                    {ck.source}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {timeAgo(ck.createdAt)}
                  {ck.tag ? ` · ${ck.tag}` : ''}
                  {ck.stashSha ? ' · includes uncommitted changes' : ''}
                </div>
              </div>
            ))}
          </div>
        )}
        <Tip content="Open the checkpoint manager in the Changes tab (create, compare, prune)">
          <span className="mt-2 inline-flex w-full">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full text-[11px]"
              onClick={openInChanges}
            >
              Manage in Changes tab
            </Button>
          </span>
        </Tip>
      </PopoverContent>
    </Popover>
  )
}
