/**
 * Muted, non-interactive badge row summarizing the git activity detected in
 * an assistant turn's successful shell commands (see git-activity.ts).
 */
import React from 'react'
import { ArrowUpFromLine, GitBranch, GitCommitHorizontal, GitMerge } from 'lucide-react'
import type { GitActivity } from './git-activity'

const PILL = 'flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5'

export function GitActivityBadges({ activity }: { activity: GitActivity }): React.JSX.Element {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
      {activity.commits > 0 && (
        <span className={PILL}>
          <GitCommitHorizontal size={11} />
          {activity.commits === 1 ? '1 commit' : `${activity.commits} commits`}
        </span>
      )}
      {activity.pushes > 0 && (
        <span className={PILL}>
          <ArrowUpFromLine size={11} />
          pushed
        </span>
      )}
      {activity.merges > 0 && (
        <span className={PILL}>
          <GitMerge size={11} />
          merged
        </span>
      )}
      {activity.branchSwitch && (
        <span className={PILL}>
          <GitBranch size={11} />→ {activity.branchSwitch}
        </span>
      )}
    </div>
  )
}
