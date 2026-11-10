/**
 * Repo Wiki tab: agent-generated architecture docs for the selected project.
 * Pages are served from the per-project store (<userData>/wiki/<projectId>/)
 * via the wiki router; generation runs behind the scenes in the project's
 * dedicated "Repo wiki" chat (wiki.generate — no chat selection required).
 * While a run is active this view polls wiki.status, which also recovers
 * leftover staging (e.g. the app closed mid-run) once the wiki chat is idle.
 * Shows a staleness banner when the project HEAD moved since generation.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useSetAtom } from 'jotai'
import { BookText, Loader2, MessageSquare, RefreshCw, Trash2 } from 'lucide-react'
import { mainTabAtom, selectedChatIdAtom } from '../../lib/atoms'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { Markdown } from '../agents/Markdown'

export function WikiView({ projectId }: { projectId: string }): React.JSX.Element {
  const utils = trpc.useUtils()
  const setTab = useSetAtom(mainTabAtom)
  const setSelectedChat = useSetAtom(selectedChatIdAtom)
  const confirm = useConfirm()
  const [selected, setSelected] = useState<string | null>(null)

  const pages = trpc.wiki.pages.useQuery({ projectId })
  const meta = trpc.wiki.meta.useQuery({ projectId })
  const pageName =
    selected && pages.data?.some((p) => p.name === selected)
      ? selected
      : (pages.data?.[0]?.name ?? null)
  const page = trpc.wiki.page.useQuery(
    { projectId, name: pageName ?? '' },
    { enabled: pageName !== null }
  )
  const status = trpc.wiki.status.useQuery(
    { projectId },
    { refetchInterval: (q) => (q.state.data?.running ? 2500 : false) }
  )
  const generate = trpc.wiki.generate.useMutation({
    onSuccess: () => void utils.wiki.status.invalidate()
  })
  const remove = trpc.wiki.remove.useMutation({
    onSuccess: () => void utils.wiki.invalidate()
  })

  const running = status.data?.running ?? false
  const runChatId = status.data?.chatId ?? null

  // Refresh pages when a run finishes (running → false) or when the status
  // poll recovered leftover staging into the store.
  const prevRunning = useRef(false)
  useEffect(() => {
    if ((prevRunning.current && !running) || status.data?.collected) void utils.wiki.invalidate()
    prevRunning.current = running
  }, [running, status.data?.collected, utils])

  const onDelete = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Delete the wiki?',
      description:
        'Removes all generated wiki pages for this project. You can regenerate them at any time.',
      confirmLabel: 'Delete'
    })
    if (ok) {
      setSelected(null)
      remove.mutate({ projectId })
    }
  }

  const viewRun = (): void => {
    if (!runChatId) return
    setSelectedChat(runChatId)
    setTab('chat')
  }

  // Relative .md links between wiki pages navigate in-wiki instead of
  // through the external-link window handler.
  const onContentClickCapture = (e: React.MouseEvent): void => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (!href.endsWith('.md') || href.includes('://') || href.startsWith('/')) return
    e.preventDefault()
    e.stopPropagation()
    const name = href.split('/').pop()
    if (name) setSelected(name)
  }

  const hasPages = (pages.data?.length ?? 0) > 0
  const behind = meta.data?.behind ?? null

  const generateButton = (label: string): React.JSX.Element => (
    <Tip
      content={
        running
          ? 'Wiki generation is already running'
          : 'Generate the wiki behind the scenes in this project\u2019s dedicated "Repo wiki" chat'
      }
    >
      <span className="inline-flex">
        <Button
          size="sm"
          variant="secondary"
          disabled={running || generate.isPending}
          onClick={() => generate.mutate({ projectId })}
        >
          {running || generate.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          {label}
        </Button>
      </span>
    </Tip>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookText size={14} className="shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">Repo wiki</span>
          {meta.data && (
            <span className="truncate text-[11px] text-muted-foreground">
              generated {timeAgo(meta.data.generatedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasPages && (
            <Tip content="Delete all generated wiki pages for this project">
              <span className="inline-flex">
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => void onDelete()}
                >
                  <Trash2 size={13} />
                </Button>
              </span>
            </Tip>
          )}
          {generateButton(hasPages ? 'Refresh' : 'Generate')}
        </div>
      </div>

      {generate.error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-[11px] text-red-600 dark:text-red-400">
          {generate.error.message}
        </div>
      )}

      {running && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-accent/40 px-4 py-1.5">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Generating the wiki in this project&apos;s &quot;Repo wiki&quot; chat&hellip; pages
            appear here when the run finishes.
          </div>
          <Tip content="Open the wiki-generation chat to watch the run">
            <span className="inline-flex">
              <Button size="sm" variant="ghost" disabled={!runChatId} onClick={viewRun}>
                <MessageSquare size={13} />
                View run
              </Button>
            </span>
          </Tip>
        </div>
      )}

      {hasPages && behind !== null && behind > 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          This wiki is {behind} commit{behind === 1 ? '' : 's'} behind the repository — refresh it
          to pick up the latest changes.
        </div>
      )}

      {pages.isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : !hasPages ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <BookText size={24} className="text-muted-foreground" />
          <div className="text-sm font-medium">No wiki yet</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            Generate an agent-written wiki for this project: an architecture overview with a Mermaid
            diagram, plus a page per major module with clickable source references. Generation runs
            behind the scenes in a dedicated chat.
          </div>
          {generateButton('Generate wiki')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-56 shrink-0 overflow-y-auto border-r border-border py-2">
            {pages.data?.map((p) => (
              <Tip key={p.name} content={`Open ${p.name}`} side="right">
                <button
                  onClick={() => setSelected(p.name)}
                  className={cn(
                    'block w-full cursor-pointer truncate px-3 py-1.5 text-left text-xs',
                    p.name === pageName
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p.title}
                </button>
              </Tip>
            ))}
          </div>
          <div
            className="min-w-0 flex-1 overflow-y-auto px-6 py-4"
            onClickCapture={onContentClickCapture}
          >
            {page.data?.content != null ? (
              <Markdown text={page.data.content} linkifyFileRefs />
            ) : page.isLoading ? (
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            ) : (
              <div className="text-xs text-muted-foreground">Page not found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
