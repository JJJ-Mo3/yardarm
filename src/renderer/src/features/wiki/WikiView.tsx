/**
 * Repo Wiki tab: agent-generated architecture docs for the selected project.
 * Pages are served from the per-project store (<userData>/wiki/<projectId>/)
 * via the wiki router; generation runs as a visible marked run in the selected
 * chat, dispatched through the primary ChatView's palette bridge
 * (/wiki generate). Shows a staleness banner when the project HEAD moved
 * since generation, and opportunistically collects leftover staging (e.g.
 * after the app closed mid-run) when opened with a chat selected.
 */
import React, { useEffect, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { BookText, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { mainTabAtom } from '../../lib/atoms'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { BUILTIN_COMMANDS, paletteDispatchAtom } from '../agents/slash-commands'
import { Markdown } from '../agents/Markdown'

const WIKI_COMMAND = BUILTIN_COMMANDS.find((c) => c.name === 'wiki')

export function WikiView({
  projectId,
  chatId
}: {
  projectId: string
  chatId: string | null
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const setTab = useSetAtom(mainTabAtom)
  const dispatch = useAtomValue(paletteDispatchAtom)
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
  const collect = trpc.wiki.collect.useMutation({
    onSuccess: (r) => {
      if (r.collected) void utils.wiki.invalidate()
    }
  })
  const remove = trpc.wiki.remove.useMutation({
    onSuccess: () => void utils.wiki.invalidate()
  })

  // App-closed-mid-run recovery: collect any finished staging left in the
  // chat worktree. Retry-safe no-op when there is nothing staged.
  const { mutate: collectMutate } = collect
  useEffect(() => {
    if (chatId) collectMutate({ chatId })
  }, [chatId, collectMutate])

  const canGenerate = dispatch !== null && chatId !== null && WIKI_COMMAND !== undefined
  const generate = (): void => {
    if (!dispatch || !WIKI_COMMAND) return
    dispatch.run(WIKI_COMMAND, 'generate')
    setTab('chat')
  }

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
        canGenerate
          ? 'Run wiki generation as an agent task in the selected chat (switches to the Chat tab)'
          : 'Select a chat first — wiki generation runs as an agent task in its worktree'
      }
    >
      <span className="inline-flex">
        <Button size="sm" variant="secondary" disabled={!canGenerate} onClick={generate}>
          <RefreshCw size={13} />
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
            diagram, plus a page per major module with clickable source references.
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
