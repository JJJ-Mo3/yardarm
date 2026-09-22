/**
 * Header popover for GitHub PR subscriptions: the active thread can subscribe
 * to one or more PRs (working = agent acts on updates, review = notifications
 * only). Backed by the agent host's githubPrStatus/Subscribe/Unsubscribe
 * commands, which wrap the SDK's GithubSignals service — only constructed when
 * GitHub signals are enabled in Settings → Connectors.
 */
import React, { useState } from 'react'
import { GitPullRequest, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Tip } from '../../components/ui/tooltip'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { timeAgo } from '../../lib/utils'
import type { GithubPrSubscriptionInfo } from '../../../../shared/ipc-types'

function SubscriptionRow({
  sub,
  onUnsubscribe,
  busy
}: {
  sub: GithubPrSubscriptionInfo
  onUnsubscribe: () => void
  busy: boolean
}): React.JSX.Element {
  const slug = sub.owner && sub.repo ? `${sub.owner}/${sub.repo}` : ''
  const syncLine =
    sub.lastSyncStatus === 'error'
      ? `sync failed${sub.lastSyncError ? `: ${sub.lastSyncError}` : ''}`
      : sub.lastSyncAt
        ? `synced ${timeAgo(Date.parse(sub.lastSyncAt))}`
        : 'not synced yet'
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium" title={`${slug}#${sub.number}`}>
          {slug ? `${slug} ` : ''}#{sub.number}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded bg-secondary px-1 py-px text-[10px] text-muted-foreground">
            {sub.mode}
          </span>
          {sub.lastObservedState && (
            <span className="text-[10px] text-muted-foreground">{sub.lastObservedState}</span>
          )}
          <Tip content={`Unsubscribe from PR #${sub.number}`}>
            <span className="inline-flex">
              <button
                className="text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
                onClick={onUnsubscribe}
                disabled={busy}
              >
                <X size={12} />
              </button>
            </span>
          </Tip>
        </div>
      </div>
      <div
        className={`mt-0.5 truncate text-[10px] ${
          sub.lastSyncStatus === 'error' ? 'text-red-500' : 'text-muted-foreground'
        }`}
        title={syncLine}
      >
        {syncLine}
        {sub.lastObservedCiState ? ` · CI ${sub.lastObservedCiState}` : ''}
      </div>
      {sub.lastNotificationSummary && (
        <div
          className="mt-0.5 truncate text-[10px] text-muted-foreground"
          title={sub.lastNotificationSummary}
        >
          {sub.lastNotificationSummary}
        </div>
      )}
    </div>
  )
}

export function GithubPrPopover({
  subchatId,
  open,
  onOpenChange
}: {
  subchatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  // Refetch while open so the background poller's sync/CI updates show live.
  const status = trpc.agent.githubPrStatus.useQuery(
    { subchatId },
    { enabled: open, staleTime: 10_000, refetchInterval: 15_000, retry: false }
  )
  const [prNumber, setPrNumber] = useState('')
  const [mode, setMode] = useState<'working' | 'review'>('working')
  const [error, setError] = useState<string | null>(null)

  const onResult = (data: (typeof status)['data']): void => {
    setError(null)
    if (data) utils.agent.githubPrStatus.setData({ subchatId }, data)
  }
  const subscribe = trpc.agent.githubPrSubscribe.useMutation({
    onSuccess: (data) => {
      onResult(data)
      setPrNumber('')
    },
    onError: (e) => setError(e.message)
  })
  const unsubscribe = trpc.agent.githubPrUnsubscribe.useMutation({
    onSuccess: onResult,
    onError: (e) => setError(e.message)
  })
  const busy = subscribe.isPending || unsubscribe.isPending

  const handleSubscribe = (): void => {
    const num = Number.parseInt(prNumber.trim(), 10)
    if (!Number.isInteger(num) || num <= 0) {
      setError('Enter a PR number')
      return
    }
    subscribe.mutate({ subchatId, number: num, mode })
  }

  const data = status.data
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tip content="GitHub PR subscriptions for this thread (/github)">
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer">
            <GitPullRequest size={11} />
            prs
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-72">
        <div className="mb-1.5 text-xs font-medium">PR subscriptions</div>
        {status.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
        {status.error && (
          <div className="text-[11px] text-red-500">
            Failed to load subscriptions: {status.error.message}
          </div>
        )}
        {data && !data.enabled && (
          <div className="text-[11px] text-muted-foreground">
            GitHub signals are disabled. Enable them in Settings → Connectors, then restart this
            agent to subscribe threads to PRs.
          </div>
        )}
        {data?.enabled && (
          <div className="space-y-2">
            {data.subscriptions.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">
                No PR subscriptions. Subscribe this thread to a PR to have the agent follow
                comments, reviews and CI results.
              </div>
            ) : (
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {data.subscriptions.map((sub) => (
                  <SubscriptionRow
                    key={`${sub.owner}/${sub.repo}#${sub.number}`}
                    sub={sub}
                    busy={busy}
                    onUnsubscribe={() =>
                      unsubscribe.mutate({
                        subchatId,
                        number: sub.number,
                        owner: sub.owner || undefined,
                        repo: sub.repo || undefined
                      })
                    }
                  />
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Input
                value={prNumber}
                onChange={(e) => setPrNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubscribe()
                }}
                placeholder="PR #"
                inputMode="numeric"
                className="h-7 w-16 text-[11px]"
              />
              <Tip content="working: the agent acts on PR updates · review: notifications only">
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'working' | 'review')}
                  className="h-7 rounded border border-border bg-background px-1 text-[11px]"
                >
                  <option value="working">working</option>
                  <option value="review">review</option>
                </select>
              </Tip>
              <Tip content="Subscribe this thread to the PR (repo defaults to the origin remote) — re-subscribing an existing PR switches its mode">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={handleSubscribe}
                    disabled={busy || !prNumber.trim()}
                  >
                    Subscribe
                  </Button>
                </span>
              </Tip>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {data.polling ? 'Polling active' : 'Polling idle'}
              {data.pollIntervalMs
                ? ` · checks every ${Math.round(data.pollIntervalMs / 1000)}s`
                : ''}
            </div>
          </div>
        )}
        {error && <div className="mt-1.5 text-[11px] text-red-500">{error}</div>}
      </PopoverContent>
    </Popover>
  )
}
