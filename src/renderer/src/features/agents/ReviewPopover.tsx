/**
 * Review picker popover for the chat header. Kick off an agent code review of
 * the chat's local changes (vs its base branch) or of a specific open PR
 * (listed via the GitHub CLI). Reviews are sent as marker messages — the
 * transcript shows a compact "Review: …" line instead of a user bubble.
 */
import React, { useEffect, useState } from 'react'
import { GitPullRequest, ScanSearch } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Tip } from '../../components/ui/tooltip'
import { buildLocalReviewPrompt, buildPrReviewPrompt, buildReviewMarker } from './review-prompts'

export function ReviewPopover({
  cwd,
  baseBranch,
  running,
  open,
  onOpenChange,
  onReview
}: {
  /** Worktree (or project) path PR queries run in; null while the chat loads. */
  cwd: string | null
  /** The worktree's base branch, or null when unknown (agent auto-detects). */
  baseBranch: string | null
  /** Whether a run is in progress (the review would queue behind it). */
  running: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Send the expanded review prompt as a marker message. */
  onReview: (content: string, marker: string) => void
}): React.JSX.Element {
  const gh = trpc.git.ghAvailable.useQuery(undefined, { enabled: open, staleTime: 60_000 })
  const prs = trpc.git.listPrs.useQuery(
    { cwd: cwd ?? '' },
    { enabled: open && !!cwd && gh.data?.available === true, staleTime: 30_000 }
  )
  const [focus, setFocus] = useState('')

  useEffect(() => {
    // Reset the focus field whenever the popover closes or the chat changes.
    setFocus('')
  }, [open, cwd])

  const pick = (content: string, marker: string): void => {
    onReview(content, marker)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tip content="Review — have the agent code-review this chat's changes or an open PR (/review)">
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer">
            <ScanSearch size={11} />
            review
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-80">
        <div className="mb-1.5 text-xs font-medium">Code review</div>
        <div className="space-y-2">
          <Tip content="Optional — a specific area, file, or concern the review should focus on">
            <Input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Focus (optional), e.g. error handling"
              className="h-6 text-[11px]"
            />
          </Tip>

          <Tip content="Review this chat's committed and uncommitted changes against its base branch">
            <button
              onClick={() =>
                pick(
                  buildLocalReviewPrompt({
                    baseBranch: baseBranch ?? undefined,
                    focus: focus.trim() || undefined
                  }),
                  buildReviewMarker({ kind: 'local' })
                )
              }
              className="w-full rounded-md border border-border bg-accent/40 px-2 py-1.5 text-left text-[11px] hover:bg-accent cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <ScanSearch size={11} className="shrink-0" />
                Review local changes
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {baseBranch ? `vs ${baseBranch}` : 'base auto-detected'}
              </div>
            </button>
          </Tip>

          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Open PRs
            </div>
            {gh.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
            {gh.data && !gh.data.available && (
              <div className="text-[11px] text-muted-foreground">
                Install the GitHub CLI (gh) to review PRs.
              </div>
            )}
            {gh.data?.available && (
              <>
                {prs.isLoading && (
                  <div className="text-[11px] text-muted-foreground">Loading PRs…</div>
                )}
                {prs.error && (
                  <div className="text-[11px] text-destructive selectable">{prs.error.message}</div>
                )}
                {prs.data && prs.data.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">No open PRs.</div>
                )}
                {prs.data && prs.data.length > 0 && (
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {prs.data.map((pr) => (
                      <Tip key={pr.number} content={`Review PR #${pr.number} — ${pr.title}`}>
                        <button
                          onClick={() =>
                            pick(
                              buildPrReviewPrompt(String(pr.number), focus.trim() || undefined),
                              buildReviewMarker({
                                kind: 'pr',
                                prNumber: String(pr.number),
                                title: pr.title
                              })
                            )
                          }
                          className="flex w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-left text-[11px] hover:bg-accent cursor-pointer"
                        >
                          <GitPullRequest size={11} className="shrink-0 text-green-500" />
                          <span className="min-w-0 flex-1 truncate" title={pr.title}>
                            <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
                          </span>
                          {pr.author && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {pr.author}
                            </span>
                          )}
                        </button>
                      </Tip>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {running && (
            <div className="text-[11px] text-muted-foreground">
              A run is in progress — the review will queue behind it.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
