/**
 * "From issue or PR" list for the new-chat dialog: the project's open issues
 * and open pull/merge requests (via the gh / glab CLI), filtered by a search
 * box. Picking an issue creates a chat titled from it with the composer
 * prefilled; picking a PR/MR creates a chat whose worktree is that request's
 * branch. Creation itself is the parent's job (onPickIssue / onPickPr).
 */
import React, { useState } from 'react'
import { CircleDot, GitPullRequest, Loader2, RotateCw } from 'lucide-react'
import type { RepoProvider } from '@shared/ipc-types'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import { filterIssues, filterPrs } from './new-chat-sources'

const ROW_CLASS =
  'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer ' +
  'disabled:cursor-default disabled:opacity-50'

export function IssuePrPicker({
  projectId,
  projectPath,
  provider,
  busy,
  onPickIssue,
  onPickPr
}: {
  projectId: string
  projectPath: string
  provider: RepoProvider
  /** A chat is being created from a picked row — rows are disabled meanwhile. */
  busy: boolean
  onPickIssue: (number: number) => void
  onPickPr: (number: number) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const issues = trpc.chats.listIssues.useQuery({ projectId, limit: 100 }, { staleTime: 30_000 })
  const prs = trpc.git.listPrs.useQuery({ cwd: projectPath, limit: 50 }, { staleTime: 30_000 })

  const gitlab = provider === 'gitlab'
  const prWord = gitlab ? 'merge request' : 'pull request'
  const shownIssues = filterIssues(issues.data ?? [], query)
  const shownPrs = filterPrs(prs.data ?? [], query)
  const loading = issues.isFetching || prs.isFetching
  const nothing =
    !issues.isLoading && !prs.isLoading && shownIssues.length === 0 && shownPrs.length === 0

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        Pick an open issue to start a chat with the issue&apos;s details placed in the message box
        (nothing is sent until you send it), or an open {prWord} to work on its branch in a new
        worktree.
      </div>
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search open issues and ${prWord}s`}
          aria-label={`Search open issues and ${prWord}s`}
          spellCheck={false}
        />
        <Tip content={`Reload the open issues and ${prWord}s from ${gitlab ? 'GitLab' : 'GitHub'}`}>
          <span className="inline-flex">
            <Button
              aria-label="Reload issues and pull requests"
              size="icon"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                void issues.refetch()
                void prs.refetch()
              }}
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
            </Button>
          </span>
        </Tip>
      </div>
      {issues.error && (
        <div className="text-xs text-destructive selectable">
          Could not list issues: {issues.error.message}
        </div>
      )}
      {prs.error && (
        <div className="text-xs text-destructive selectable">
          Could not list {prWord}s: {prs.error.message}
        </div>
      )}
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
        {(issues.isLoading || prs.isLoading) && (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">Loading…</div>
        )}
        {shownIssues.length > 0 && (
          <div className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Issues
          </div>
        )}
        {shownIssues.map((issue) => (
          <Tip
            key={`issue-${issue.number}`}
            content={`Create a chat for issue #${issue.number} and put its title, description and link in the message box`}
            side="right"
          >
            <span className="inline-flex w-full">
              <button
                className={ROW_CLASS}
                disabled={busy}
                onClick={() => onPickIssue(issue.number)}
              >
                <CircleDot size={12} className="shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  #{issue.number}
                </span>
                <span className="min-w-0 flex-1 truncate" title={issue.title}>
                  {issue.title}
                </span>
                {issue.labels.slice(0, 2).map((label) => (
                  <span
                    key={label}
                    className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </button>
            </span>
          </Tip>
        ))}
        {shownPrs.length > 0 && (
          <div className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {gitlab ? 'Merge requests' : 'Pull requests'}
          </div>
        )}
        {shownPrs.map((pr) => (
          <Tip
            key={`pr-${pr.number}`}
            content={`Create a chat in a new worktree on this ${prWord}'s branch (${pr.headRefName})`}
            side="right"
          >
            <span className="inline-flex w-full">
              <button className={ROW_CLASS} disabled={busy} onClick={() => onPickPr(pr.number)}>
                <GitPullRequest size={12} className="shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {gitlab ? '!' : '#'}
                  {pr.number}
                </span>
                <span className="min-w-0 flex-1 truncate" title={pr.title}>
                  {pr.title}
                </span>
                <span
                  className="max-w-[35%] shrink-0 truncate font-mono text-[10px] text-muted-foreground"
                  title={pr.headRefName}
                >
                  {pr.headRefName}
                </span>
              </button>
            </span>
          </Tip>
        ))}
        {nothing && (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {query.trim()
              ? `No open issues or ${prWord}s match “${query.trim()}”.`
              : `No open issues or ${prWord}s.`}
          </div>
        )}
      </div>
      {busy && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          Creating the chat — fetching and setting up the worktree…
        </div>
      )}
    </div>
  )
}
