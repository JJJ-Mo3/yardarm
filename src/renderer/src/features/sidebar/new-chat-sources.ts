/**
 * Pure helpers for the new-chat dialog: the approval text listing a project's
 * not-yet-approved worktree setup (commands, files to copy, teardown
 * commands), and the search filter over the "From issue or PR" list.
 */

export interface PendingWorktreeSetup {
  pendingSetupCommands: string[]
  pendingCopyFiles: string[]
  pendingTeardownCommands: string[]
}

/** True when the created chat reported anything awaiting approval. */
export function hasPendingSetup(chat: PendingWorktreeSetup): boolean {
  return (
    chat.pendingSetupCommands.length > 0 ||
    chat.pendingCopyFiles.length > 0 ||
    chat.pendingTeardownCommands.length > 0
  )
}

/** Body of the approval prompt: every list the single approval would cover. */
export function describePendingSetup(chat: PendingWorktreeSetup): string {
  const sections: string[] = []
  if (chat.pendingSetupCommands.length > 0) {
    sections.push(
      'Setup commands (run in the new worktree):\n' + chat.pendingSetupCommands.join('\n')
    )
  }
  if (chat.pendingCopyFiles.length > 0) {
    sections.push(
      'Files to copy from the project folder (untracked files matching):\n' +
        chat.pendingCopyFiles.join('\n')
    )
  }
  if (chat.pendingTeardownCommands.length > 0) {
    sections.push(
      'Teardown commands (run before a worktree is removed):\n' +
        chat.pendingTeardownCommands.join('\n')
    )
  }
  return (
    'This project defines worktree setup in .yardarm/worktree.json. It has not been approved ' +
    'yet (or changed since), so nothing was run or copied:\n\n' +
    sections.join('\n\n') +
    '\n\nApprove to apply it to this chat now and to future worktrees of this project.'
  )
}

export interface IssueRow {
  number: number
  title: string
  author: string
  labels: string[]
}

export interface PrRow {
  number: number
  title: string
  author: string
  headRefName: string
}

function matches(query: string, number: number, fields: string[]): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  const bare = q.replace(/^[#!]/, '')
  if (/^\d+$/.test(bare) && String(number).startsWith(bare)) return true
  return fields.some((f) => f.toLowerCase().includes(q))
}

/** Issues whose number, title, author or a label matches the query (all when empty). */
export function filterIssues<T extends IssueRow>(issues: T[], query: string): T[] {
  return issues.filter((i) => matches(query, i.number, [i.title, i.author, ...i.labels]))
}

/** PRs/MRs whose number, title, author or head branch matches the query (all when empty). */
export function filterPrs<T extends PrRow>(prs: T[], query: string): T[] {
  return prs.filter((p) => matches(query, p.number, [p.title, p.author, p.headRefName]))
}
