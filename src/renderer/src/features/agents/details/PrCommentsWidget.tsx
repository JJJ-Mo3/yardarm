/**
 * Details-panel widget: the GitHub PR conversation (issue comments + reviews)
 * for the chat's branch, polled at a modest interval while the panel is open.
 * Renders nothing when the repo isn't GitHub, gh is missing, or the branch has
 * no open PR — the parent decides section placement via the render prop.
 */
import React from 'react'
import { trpc } from '../../../lib/trpc'
import { timeAgo } from '../../../lib/utils'

/** Colored label for a review state; null for plain comments. */
function reviewBadge(kind: string): { label: string; className: string } | null {
  if (kind === 'comment') return null
  if (kind === 'APPROVED') return { label: 'approved', className: 'text-emerald-500' }
  if (kind === 'CHANGES_REQUESTED') return { label: 'changes requested', className: 'text-red-500' }
  return { label: 'reviewed', className: 'text-muted-foreground' }
}

export function PrCommentsWidget({
  cwd,
  children
}: {
  cwd: string | null
  /** Section wrapper supplied by the parent, rendered only when a PR exists. */
  children: (content: React.ReactNode) => React.JSX.Element
}): React.JSX.Element | null {
  const pr = trpc.git.prComments.useQuery(
    { cwd: cwd ?? '' },
    { enabled: !!cwd, refetchInterval: 60_000, retry: false }
  )
  if (!pr.data) return null
  return children(
    <div className="space-y-1.5">
      <a
        href={pr.data.url}
        target="_blank"
        rel="noreferrer"
        className="block truncate text-[11px] text-primary underline"
        title={pr.data.url}
      >
        #{pr.data.number} {pr.data.title}
      </a>
      {pr.data.comments.length === 0 && (
        <div className="text-[11px] text-muted-foreground">No comments yet.</div>
      )}
      {pr.data.comments.map((c, i) => {
        const badge = reviewBadge(c.kind)
        const ts = c.createdAt ? Date.parse(c.createdAt) : NaN
        return (
          <div key={i} className="rounded border border-border/60 px-1.5 py-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="min-w-0 truncate font-medium">{c.author}</span>
              {badge && <span className={`shrink-0 ${badge.className}`}>{badge.label}</span>}
              {Number.isFinite(ts) && <span className="ml-auto shrink-0">{timeAgo(ts)}</span>}
            </div>
            {c.body.trim() && (
              <div className="mt-0.5 line-clamp-4 text-[11px] whitespace-pre-wrap selectable">
                {c.body.trim()}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
