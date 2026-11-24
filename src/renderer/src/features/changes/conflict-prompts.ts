/**
 * Prompts for "Have the agent resolve it": when a merge into the base branch
 * or a pull stops on conflicts, the app aborts it (the project folder is never
 * left mid-merge) and these ask the chat's agent to do the conflicting merge
 * inside its own worktree, where resolving is safe. Pure.
 */

/** At most this many conflicted paths are listed; the rest are counted. */
const MAX_LISTED_FILES = 20

function fileList(files: string[]): string[] {
  if (files.length === 0) return []
  const shown = files.slice(0, MAX_LISTED_FILES).map((f) => `- ${f}`)
  const rest = files.length - MAX_LISTED_FILES
  if (rest > 0) shown.push(`- … and ${rest} more`)
  return ['Conflicted files:', ...shown, '']
}

const RESOLVE_STEPS = [
  'Resolve every conflict, keeping the intent of both sides — read the surrounding code rather than just picking one side, and tell me about any conflict where the right resolution is a judgement call.',
  "Run the project's checks (typecheck, lint, tests — whatever this project uses) and fix anything the merge broke.",
  'Commit the merge.'
]

function numbered(steps: string[]): string[] {
  return steps.map((s, i) => `${i + 1}. ${s}`)
}

/** Merging the chat's branch into its base conflicted (and was aborted). */
export function buildMergeConflictPrompt(opts: {
  branch: string
  baseBranch: string
  files: string[]
}): string {
  const { branch, baseBranch } = opts
  return [
    `Merging \`${branch}\` into \`${baseBranch}\` stopped on conflicts, so the merge was aborted and \`${baseBranch}\` is unchanged.`,
    '',
    ...fileList(opts.files),
    `Please resolve this inside this chat's worktree, where \`${branch}\` is checked out:`,
    ...numbered([
      'Make sure the working tree is clean first — commit finished work, and ask me about anything uncommitted you are unsure of.',
      `Merge the base branch into this branch: \`git merge ${baseBranch}\`.`,
      ...RESOLVE_STEPS
    ]),
    '',
    `Do not switch branches, do not touch the \`${baseBranch}\` checkout in the project folder, and do not push. When you are done, tell me, and I will retry the merge into \`${baseBranch}\`.`
  ].join('\n')
}

/** Pulling the chat's branch from its upstream conflicted (and was aborted). */
export function buildPullConflictPrompt(opts: { branch: string; files: string[] }): string {
  const { branch } = opts
  return [
    `Pulling \`${branch}\` from its upstream stopped on conflicts, so the pull was aborted and the branch is unchanged.`,
    '',
    ...fileList(opts.files),
    `Please resolve this inside this chat's worktree, where \`${branch}\` is checked out:`,
    ...numbered([
      'Make sure the working tree is clean first — commit finished work, and ask me about anything uncommitted you are unsure of.',
      'Fetch and merge the upstream branch: `git fetch`, then `git merge @{upstream}`.',
      ...RESOLVE_STEPS
    ]),
    '',
    'Do not switch branches and do not push. When you are done, tell me, and I will pull and push again.'
  ].join('\n')
}
