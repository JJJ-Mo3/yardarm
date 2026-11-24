/**
 * CI check status for a branch's open PR/MR: the provider-neutral shape the
 * details panel renders, pure parsers for the `gh` / `glab` CLI JSON that
 * feeds it, and the "Fix failing checks" prompt builder.
 */

/** Coarse outcome every provider state maps onto. */
export type CheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'

export interface PrCheck {
  name: string
  /** Provider's raw state, lowercased for display (e.g. "failure", "in_progress"). */
  state: string
  bucket: CheckBucket
  /** Web URL of the run/job; '' when the provider gave none. */
  link: string
  /** Workflow (GitHub) or stage (GitLab) the check belongs to; '' when unknown. */
  workflow: string
}

export interface PrChecks {
  number: number
  title: string
  url: string
  /** Whether auto-merge is already enabled for this PR/MR. */
  autoMerge: boolean
  checks: PrCheck[]
}

export type MergeMethod = 'merge' | 'squash' | 'rebase'

const BUCKETS: readonly CheckBucket[] = ['pass', 'fail', 'pending', 'skipping', 'cancel']
const BUCKET_ORDER: Record<CheckBucket, number> = {
  fail: 0,
  cancel: 1,
  pending: 2,
  pass: 3,
  skipping: 4
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Failing first, then cancelled, pending, passing, skipped; stable by name within a group. */
export function sortChecks(checks: PrCheck[]): PrCheck[] {
  return [...checks].sort(
    (a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || a.name.localeCompare(b.name)
  )
}

/** Bucket for a GitHub check state, used when the CLI's own `bucket` is absent. */
export function bucketForGithubState(state: string): CheckBucket {
  switch (state.toUpperCase()) {
    case 'SUCCESS':
      return 'pass'
    case 'FAILURE':
    case 'ERROR':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
      return 'fail'
    case 'CANCELLED':
      return 'cancel'
    case 'SKIPPED':
    case 'NEUTRAL':
      return 'skipping'
    default:
      return 'pending'
  }
}

/**
 * Parse `gh pr checks --json name,state,bucket,link,workflow` stdout. Returns
 * null when the text is not the expected JSON array (e.g. empty stdout
 * because gh only printed an error).
 */
export function parseGhChecks(stdout: string): PrCheck[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const checks: PrCheck[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const name = str(r.name)
    if (!name) continue
    const state = str(r.state)
    const bucket = str(r.bucket) as CheckBucket
    checks.push({
      name,
      state: state.toLowerCase(),
      bucket: BUCKETS.includes(bucket) ? bucket : bucketForGithubState(state),
      link: str(r.link),
      workflow: str(r.workflow)
    })
  }
  return sortChecks(checks)
}

/** Bucket for a GitLab pipeline/job status. */
export function bucketForGitlabStatus(status: string, allowFailure = false): CheckBucket {
  switch (status) {
    case 'success':
      return 'pass'
    case 'failed':
      // A failed job that is allowed to fail does not block the pipeline.
      return allowFailure ? 'skipping' : 'fail'
    case 'canceled':
    case 'canceling':
      return 'cancel'
    case 'skipped':
    case 'manual':
      return 'skipping'
    default:
      return 'pending'
  }
}

/**
 * Parse a GitLab `pipelines/:id/jobs` API response (as printed by
 * `glab api`). Returns null when the text is not a JSON array.
 */
export function parseGitlabJobs(stdout: string): PrCheck[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const checks: PrCheck[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const name = str(r.name)
    if (!name) continue
    const status = str(r.status)
    const allowFailure = r.allow_failure === true
    checks.push({
      name,
      state: status === 'failed' && allowFailure ? 'failed (allowed)' : status,
      bucket: bucketForGitlabStatus(status, allowFailure),
      link: str(r.web_url),
      workflow: str(r.stage)
    })
  }
  return sortChecks(checks)
}

/** Open MR fields read from `glab mr view --output json`. */
export interface GitlabMrInfo {
  number: number
  title: string
  url: string
  /** False for merged/closed MRs. */
  open: boolean
  autoMerge: boolean
  pipeline: { id: number; projectId: number | null; status: string; url: string } | null
}

/** Parse `glab mr view --output json` stdout; null when it is not an MR object. */
export function parseGitlabMr(stdout: string): GitlabMrInfo | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.iid !== 'number') return null
  const hp = r.head_pipeline
  let pipeline: GitlabMrInfo['pipeline'] = null
  if (hp && typeof hp === 'object') {
    const p = hp as Record<string, unknown>
    if (typeof p.id === 'number' && Number.isInteger(p.id)) {
      pipeline = {
        id: p.id,
        projectId:
          typeof p.project_id === 'number' && Number.isInteger(p.project_id) ? p.project_id : null,
        status: str(p.status),
        url: str(p.web_url)
      }
    }
  }
  return {
    number: r.iid,
    title: str(r.title),
    url: str(r.web_url),
    open: str(r.state) === 'opened',
    autoMerge: r.merge_when_pipeline_succeeds === true || r.auto_merge_enabled === true,
    pipeline
  }
}

/** A single row standing in for a whole GitLab pipeline (when its jobs can't be listed). */
export function gitlabPipelineCheck(pipeline: { status: string; url: string }): PrCheck {
  return {
    name: 'Pipeline',
    state: pipeline.status,
    bucket: bucketForGitlabStatus(pipeline.status),
    link: pipeline.url,
    workflow: ''
  }
}

/**
 * The repo's default merge method from
 * `gh repo view --json viewerDefaultMergeMethod,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed`.
 * Falls back to the first allowed method, then to a merge commit.
 */
export function pickMergeMethod(stdout: string): MergeMethod {
  let r: Record<string, unknown> = {}
  try {
    const raw: unknown = JSON.parse(stdout)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) r = raw as Record<string, unknown>
  } catch {
    // fall through to the default
  }
  const allowed: Record<MergeMethod, boolean> = {
    merge: r.mergeCommitAllowed !== false,
    squash: r.squashMergeAllowed !== false,
    rebase: r.rebaseMergeAllowed !== false
  }
  const preferred = str(r.viewerDefaultMergeMethod).toLowerCase()
  if (
    (preferred === 'merge' || preferred === 'squash' || preferred === 'rebase') &&
    allowed[preferred]
  )
    return preferred
  return (['merge', 'squash', 'rebase'] as const).find((m) => allowed[m]) ?? 'merge'
}

/** GitHub Actions run id from a check link (`…/actions/runs/<id>/job/<id>`), else null. */
export function runIdFromCheckLink(link: string): string | null {
  return /\/actions\/runs\/(\d+)(?:\/|$|\?)/.exec(link)?.[1] ?? null
}

/** Distinct Actions run ids behind the failing checks, in check order. */
export function failingRunIds(checks: PrCheck[], max = 2): string[] {
  const ids: string[] = []
  for (const c of checks) {
    if (c.bucket !== 'fail') continue
    const id = runIdFromCheckLink(c.link)
    if (id && !ids.includes(id)) ids.push(id)
    if (ids.length >= max) break
  }
  return ids
}

/**
 * Tail excerpt of `gh run view --log-failed` output: drops the per-line
 * timestamp column and ANSI colors, keeps the last `maxLines` lines within
 * `maxChars` (the end of a failed log is where the error is).
 */
export function excerptFailedLog(raw: string, maxLines = 40, maxChars = 3000): string {
  const lines = raw
    // Log files start with a byte-order mark, which lands mid-line here.
    .replaceAll(String.fromCharCode(0xfeff), '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/\r$/, '')
        .replace(/\t\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, '\t')
        .trimEnd()
    )
    .filter((l) => l.trim() !== '')
  const kept: string[] = []
  let chars = 0
  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i].length > 400 ? `${lines[i].slice(0, 400)}…` : lines[i]
    if (chars + line.length + 1 > maxChars) break
    kept.unshift(line)
    chars += line.length + 1
  }
  const text = kept.join('\n')
  return kept.length < lines.length && text ? `…\n${text}` : text
}

export interface CheckCounts {
  pass: number
  fail: number
  pending: number
  other: number
}

export function countChecks(checks: PrCheck[]): CheckCounts {
  const counts: CheckCounts = { pass: 0, fail: 0, pending: 0, other: 0 }
  for (const c of checks) {
    if (c.bucket === 'pass') counts.pass++
    else if (c.bucket === 'fail') counts.fail++
    else if (c.bucket === 'pending') counts.pending++
    else counts.other++
  }
  return counts
}

/** Backtick fence longer than any backtick run in `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * Prompt asking the agent to investigate and fix the failing checks of a
 * PR/MR. `logs` are optional failed-log excerpts keyed by run id.
 */
export function buildFixChecksPrompt(opts: {
  /** e.g. "PR #12" or "MR !12". */
  ref: string
  url: string
  failing: PrCheck[]
  logs?: Array<{ runId: string; excerpt: string }>
}): string {
  const lines: string[] = [
    `These CI checks are failing on ${opts.ref} (${opts.url}):`,
    '',
    ...opts.failing.map((c) => {
      const label = c.workflow && c.workflow !== c.name ? `${c.workflow} / ${c.name}` : c.name
      return `- ${label}${c.link ? ` — ${c.link}` : ''}`
    })
  ]
  for (const log of opts.logs ?? []) {
    if (!log.excerpt.trim()) continue
    const fence = fenceFor(log.excerpt)
    lines.push('', `End of the failed log for run ${log.runId}:`, fence, log.excerpt, fence)
  }
  lines.push(
    '',
    'Investigate why each check fails — read the full logs for anything not shown above — ' +
      'reproduce the failures locally where you can, and fix the underlying cause rather than ' +
      'silencing the check. Run the relevant checks locally, then commit and push the fix to ' +
      "this branch and tell me what was wrong and what you changed. If a failure is not caused by this branch's changes, say so instead of working around it."
  )
  return lines.join('\n')
}
