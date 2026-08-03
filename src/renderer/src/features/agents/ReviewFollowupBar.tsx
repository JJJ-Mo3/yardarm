/**
 * Post-review follow-up strip shown above the composer once a review run
 * finishes: post the findings back to the PR/MR as comments, or turn them
 * into an implementation plan. When the turn ended without the agent writing
 * the review (shared=false), it instead offers a one-click nudge asking the
 * agent to share it. Derived from the transcript (findCompletedReview) —
 * nothing is persisted; dismissal is per marker id in ChatView state.
 */
import React from 'react'
import { ListTodo, MessageSquareText, ScanSearch, X } from 'lucide-react'
import type { RepoProvider } from '@shared/ipc-types'
import { trpc } from '../../lib/trpc'
import { forgeCopy } from '../../lib/forge-copy'
import { Tip } from '../../components/ui/tooltip'

export function ReviewFollowupBar({
  target,
  cwd,
  provider,
  busy,
  shared,
  onPostComments,
  onBuildPlan,
  onAskForReview,
  onDismiss
}: {
  /** What the finished review looked at (from the transcript marker). */
  target: { kind: 'local' } | { kind: 'pr'; prNumber: string }
  /** Worktree (or project) path used to look up the branch's PR/MR after a local review. */
  cwd: string | null
  /** Repo host for copy (PR vs MR); null while unknown (GitHub wording). */
  provider: RepoProvider | null
  /** Disable the actions while a send is in flight. */
  busy: boolean
  /** False when the review turn ended without the agent writing the review. */
  shared: boolean
  onPostComments: (prNumber?: string) => void
  onBuildPlan: () => void
  onAskForReview: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const fc = forgeCopy(provider)
  // After a local review, comments can only go somewhere if the branch has an
  // open PR/MR; a failed lookup (no CLI, no PR, detached worktree) just hides it.
  const branchPr = trpc.git.branchPr.useQuery(
    { cwd: cwd ?? '' },
    { enabled: shared && target.kind === 'local' && !!cwd, staleTime: 30_000, retry: false }
  )
  const prNumber =
    target.kind === 'pr'
      ? target.prNumber
      : branchPr.data
        ? String(branchPr.data.number)
        : undefined
  const showComments = target.kind === 'pr' || !!branchPr.data

  return (
    <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border bg-accent/30 px-2 py-1.5 text-[11px]">
      <ScanSearch size={12} className="shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        {shared ? 'Review finished' : "Review finished, but the agent didn't share it"}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {!shared && (
          <Tip content="Ask the agent to write out the review it just performed">
            <span className="inline-flex">
              <button
                disabled={busy}
                onClick={onAskForReview}
                className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50 cursor-pointer"
              >
                <MessageSquareText size={11} />
                Ask for the review
              </button>
            </span>
          </Tip>
        )}
        {shared && showComments && (
          <Tip
            content={
              prNumber
                ? `Post the review findings as comments on ${fc.short} ${fc.refPrefix}${prNumber}`
                : `Post the review findings as comments on the ${fc.long}`
            }
          >
            <span className="inline-flex">
              <button
                disabled={busy}
                onClick={() => onPostComments(prNumber)}
                className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50 cursor-pointer"
              >
                <MessageSquareText size={11} />
                Post review as {fc.short} comments
              </button>
            </span>
          </Tip>
        )}
        {shared && (
          <Tip content="Switch to plan mode and turn the review findings into an implementation plan">
            <span className="inline-flex">
              <button
                disabled={busy}
                onClick={onBuildPlan}
                className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50 cursor-pointer"
              >
                <ListTodo size={11} />
                Build a plan to execute
              </button>
            </span>
          </Tip>
        )}
        <Tip content="Dismiss">
          <button
            onClick={onDismiss}
            className="flex items-center rounded-md p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X size={12} />
          </button>
        </Tip>
      </div>
    </div>
  )
}
