/**
 * Details-panel widget: CI check status for the open PR/MR of the chat's
 * branch (GitHub checks via gh, GitLab pipeline jobs via glab), refreshed on
 * demand and polled at a modest interval while the panel is open. Offers
 * "Fix failing checks" (prefills the composer with the failing checks, their
 * links and — on GitHub — the end of the failed logs) and "Merge when ready"
 * (enables auto-merge). Renders nothing when the branch has no open PR/MR —
 * the parent decides section placement via the render prop.
 */
import React from 'react'
import { useSetAtom } from 'jotai'
import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  GitMerge,
  RefreshCw,
  Wrench
} from 'lucide-react'
import { trpc } from '../../../lib/trpc'
import { composerInsertAtom } from '../../../lib/atoms'
import { forgeCopy } from '../../../lib/forge-copy'
import { cn } from '../../../lib/utils'
import { Button } from '../../../components/ui/button'
import { Tip } from '../../../components/ui/tooltip'
import { useConfirm } from '../../../components/ConfirmDialog'
import {
  buildFixChecksPrompt,
  countChecks,
  failingRunIds,
  type CheckBucket,
  type PrCheck
} from '../../../../../shared/pr-checks'

function BucketIcon({ bucket }: { bucket: CheckBucket }): React.JSX.Element {
  const cls = 'mt-0.5 shrink-0'
  if (bucket === 'pass') {
    return <CircleCheck size={11} className={cn(cls, 'text-green-600 dark:text-green-500')} />
  }
  if (bucket === 'fail') return <CircleX size={11} className={cn(cls, 'text-destructive')} />
  if (bucket === 'pending') {
    return <CircleDashed size={11} className={cn(cls, 'text-amber-600 dark:text-amber-500')} />
  }
  return <CircleSlash size={11} className={cn(cls, 'text-muted-foreground')} />
}

function summary(checks: PrCheck[]): string {
  const c = countChecks(checks)
  const parts: string[] = []
  if (c.fail) parts.push(`${c.fail} failing`)
  if (c.pending) parts.push(`${c.pending} pending`)
  if (c.pass) parts.push(`${c.pass} passed`)
  if (c.other) parts.push(`${c.other} skipped`)
  return parts.join(' · ')
}

export function PrChecksWidget({
  cwd,
  children
}: {
  cwd: string | null
  /** Section wrapper supplied by the parent, rendered only when a PR/MR exists. */
  children: (content: React.ReactNode, title: string) => React.JSX.Element
}): React.JSX.Element | null {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const setComposerInsert = useSetAtom(composerInsertAtom)
  const forge = trpc.git.forgeInfo.useQuery(
    { cwd: cwd ?? '' },
    { enabled: !!cwd, staleTime: 60_000 }
  )
  const fc = forgeCopy(forge.data?.provider)
  const checksQ = trpc.git.prChecks.useQuery(
    { cwd: cwd ?? '' },
    {
      enabled: !!cwd,
      // Checks move quickly; a branch without a PR/MR is only re-probed slowly.
      refetchInterval: (query) => (query.state.data ? 30_000 : 120_000),
      retry: false
    }
  )
  const logs = trpc.git.failedCheckLogs.useMutation()
  const autoMerge = trpc.git.enableAutoMerge.useMutation({
    onSuccess: () => utils.git.prChecks.invalidate()
  })

  const pr = checksQ.data
  if (!cwd || !pr) return null
  const ref = `${fc.short} ${fc.refPrefix}${pr.number}`
  const failing = pr.checks.filter((c) => c.bucket === 'fail')

  const fixFailing = async (): Promise<void> => {
    // Failed-log excerpts are a bonus: GitHub Actions only, never blocking.
    const runIds = forge.data?.provider === 'github' ? failingRunIds(failing) : []
    const excerpts =
      runIds.length > 0 ? await logs.mutateAsync({ cwd, runIds }).catch(() => []) : []
    setComposerInsert(buildFixChecksPrompt({ ref, url: pr.url, failing, logs: excerpts }))
  }

  const mergeWhenReady = (): void => {
    void confirmDialog({
      title: 'Merge when ready?',
      description: `This enables auto-merge on ${ref}: ${fc.host} merges it on its own once the required checks and reviews pass — right away if they already have.`,
      confirmLabel: 'Enable auto-merge',
      destructive: false
    }).then((ok) => {
      if (ok) autoMerge.mutate({ cwd })
    })
  }

  return children(
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Tip content={`Open the ${fc.long} on ${fc.host} — ${pr.url}`}>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-[11px] text-primary underline"
          >
            {fc.refPrefix}
            {pr.number} {pr.title}
          </a>
        </Tip>
        <Tip content="Re-read the check status now (it also refreshes every 30 seconds)">
          <button
            aria-label="Refresh checks"
            onClick={() => void checksQ.refetch()}
            className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <RefreshCw size={11} className={cn(checksQ.isFetching && 'animate-spin')} />
          </button>
        </Tip>
      </div>
      {pr.checks.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          No checks reported for this {fc.long}.
        </div>
      ) : (
        <>
          <div className="text-[10px] text-muted-foreground">{summary(pr.checks)}</div>
          <div className="space-y-0.5">
            {pr.checks.map((c, i) => (
              <div key={`${c.workflow}/${c.name}/${i}`} className="flex items-start gap-1.5">
                <BucketIcon bucket={c.bucket} />
                {c.link ? (
                  <Tip content={`Open this check in the browser — ${c.link}`}>
                    <a
                      href={c.link}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-[11px] hover:underline"
                    >
                      {c.name}
                    </a>
                  </Tip>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[11px]" title={c.name}>
                    {c.name}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {c.state.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {failing.length > 0 && (
          <Tip content="Prefill the chat composer with the failing checks and their links (plus the end of the failed logs when available) and ask the agent to investigate and fix them">
            <span className="inline-flex">
              <Button
                size="sm"
                variant="secondary"
                disabled={logs.isPending}
                onClick={() => void fixFailing()}
              >
                <Wrench size={12} />
                {logs.isPending ? 'Collecting logs…' : 'Fix failing checks'}
              </Button>
            </span>
          </Tip>
        )}
        {pr.autoMerge ? (
          <span className="text-[10px] text-muted-foreground">Auto-merge is on.</span>
        ) : (
          <Tip
            content={`Enable auto-merge: ${fc.host} merges this ${fc.long} once its required checks and reviews pass`}
          >
            <span className="inline-flex">
              <Button
                size="sm"
                variant="secondary"
                disabled={autoMerge.isPending}
                onClick={mergeWhenReady}
              >
                <GitMerge size={12} />
                {autoMerge.isPending ? 'Enabling…' : 'Merge when ready'}
              </Button>
            </span>
          </Tip>
        )}
      </div>
      {autoMerge.isSuccess && !autoMerge.error && (
        <div className="text-[10px] text-muted-foreground">
          Auto-merge requested
          {autoMerge.data.method ? ` (${autoMerge.data.method})` : ''}.
        </div>
      )}
      {(autoMerge.error || checksQ.error) && (
        <div className="max-h-24 overflow-y-auto text-xs text-destructive selectable whitespace-pre-wrap">
          {autoMerge.error?.message ?? checksQ.error?.message}
        </div>
      )}
    </div>,
    `${fc.short} checks`
  )
}
