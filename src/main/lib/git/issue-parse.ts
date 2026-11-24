/**
 * Pure parsing/validation for "start a chat from an issue or pull request":
 * turns `gh` / `glab` JSON output into small typed records, validates the
 * numbers and branch names in it (CLI output is untrusted — a branch name is
 * chosen by whoever opened the PR), and builds the composer prefill and chat
 * title. No process spawning here; issues.ts runs the CLIs.
 */
import type { RepoProvider } from '../../../shared/ipc-types'

/** An open issue row for the new-chat picker. */
export interface IssueSummary {
  number: number
  title: string
  author: string
  url: string
  labels: string[]
  /** ISO timestamp, '' when the CLI did not report one. */
  updatedAt: string
}

/** One issue with its body, for the composer prefill. */
export interface IssueDetail {
  number: number
  title: string
  body: string
  url: string
  author: string
}

/** What is needed to check out a pull/merge request's head. */
export interface PrHead {
  number: number
  title: string
  url: string
  /** Source branch name as reported by the forge — validate before use. */
  headRefName: string
  /** Target branch, or null when missing/invalid. */
  baseRefName: string | null
  /** True when the head lives in another repository (a fork). */
  crossRepo: boolean
}

/** A positive safe integer (issue/PR numbers; never trust a CLI or renderer value otherwise). */
export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Conservative check that `name` is a well-formed git branch name (the rules
 * of `git check-ref-format --branch` that matter for building refspecs): no
 * leading dash, no whitespace/control characters, none of `~^:?*[\`, no `..`,
 * `@{` or `//`, no component starting with `.` or ending in `.lock`.
 */
export function isValidBranchName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 244) return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false
  if (name.endsWith('.') || name === '@' || name === 'HEAD') return false
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f~^:?*[\\]/.test(name)) return false
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false
  return name.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'))
}

/** The forge's read-only ref for a PR/MR head — present for forks too. */
export function prHeadRef(provider: RepoProvider, number: number): string {
  if (!isPositiveInt(number)) throw new Error('Invalid pull request number')
  return provider === 'gitlab' ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function httpUrl(value: unknown): string {
  return typeof value === 'string' && /^https?:\/\/\S+$/.test(value) ? value : ''
}

function parseArray(stdout: string, what: string): Array<Record<string, unknown>> {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new Error(`Unexpected ${what} output`)
  }
  if (!Array.isArray(raw)) throw new Error(`Unexpected ${what} output`)
  return raw.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
}

function parseObject(stdout: string, what: string): Record<string, unknown> {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new Error(`Unexpected ${what} output`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Unexpected ${what} output`)
  }
  return raw as Record<string, unknown>
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>)[key] : undefined
}

/** `gh issue list --json number,title,author,url,labels,updatedAt` → rows (bad rows dropped). */
export function parseGhIssueList(stdout: string): IssueSummary[] {
  return parseArray(stdout, 'gh issue list')
    .filter((r) => isPositiveInt(r.number))
    .map((r) => ({
      number: r.number as number,
      title: text(r.title),
      author: text(field(r.author, 'login')),
      url: httpUrl(r.url),
      labels: Array.isArray(r.labels)
        ? r.labels.map((l) => text(field(l, 'name'))).filter((n) => n.length > 0)
        : [],
      updatedAt: text(r.updatedAt)
    }))
}

/** `glab issue list --output json` → rows (`number` = issue iid; bad rows dropped). */
export function parseGlabIssueList(stdout: string): IssueSummary[] {
  return parseArray(stdout, 'glab issue list')
    .filter((r) => isPositiveInt(r.iid))
    .map((r) => ({
      number: r.iid as number,
      title: text(r.title),
      author: text(field(r.author, 'username')),
      url: httpUrl(r.web_url),
      labels: Array.isArray(r.labels)
        ? r.labels.filter((l): l is string => typeof l === 'string' && l.length > 0)
        : [],
      updatedAt: text(r.updated_at)
    }))
}

/** `gh issue view <n> --json number,title,body,url,author`. */
export function parseGhIssue(stdout: string): IssueDetail {
  const r = parseObject(stdout, 'gh issue view')
  if (!isPositiveInt(r.number)) throw new Error('Unexpected gh issue view output')
  return {
    number: r.number,
    title: text(r.title),
    body: text(r.body),
    url: httpUrl(r.url),
    author: text(field(r.author, 'login'))
  }
}

/** `glab issue view <n> --output json`. */
export function parseGlabIssue(stdout: string): IssueDetail {
  const r = parseObject(stdout, 'glab issue view')
  if (!isPositiveInt(r.iid)) throw new Error('Unexpected glab issue view output')
  return {
    number: r.iid,
    title: text(r.title),
    body: text(r.description),
    url: httpUrl(r.web_url),
    author: text(field(r.author, 'username'))
  }
}

/** `gh pr view <n> --json number,title,url,headRefName,baseRefName,isCrossRepository`. */
export function parseGhPrHead(stdout: string): PrHead {
  const r = parseObject(stdout, 'gh pr view')
  if (!isPositiveInt(r.number)) throw new Error('Unexpected gh pr view output')
  return {
    number: r.number,
    title: text(r.title),
    url: httpUrl(r.url),
    headRefName: text(r.headRefName),
    baseRefName: isValidBranchName(r.baseRefName) ? r.baseRefName : null,
    // Unknown is treated as a fork: the pull ref works for both cases.
    crossRepo: r.isCrossRepository !== false
  }
}

/** `glab mr view <n> --output json`. */
export function parseGlabMrHead(stdout: string): PrHead {
  const r = parseObject(stdout, 'glab mr view')
  if (!isPositiveInt(r.iid)) throw new Error('Unexpected glab mr view output')
  const source = r.source_project_id
  const target = r.target_project_id
  return {
    number: r.iid,
    title: text(r.title),
    url: httpUrl(r.web_url),
    headRefName: text(r.source_branch),
    baseRefName: isValidBranchName(r.target_branch) ? r.target_branch : null,
    crossRepo: !(typeof source === 'number' && typeof target === 'number' && source === target)
  }
}

const MAX_TITLE = 120
/** Issue bodies can be huge (pasted logs); the prefill keeps the head of it. */
export const MAX_ISSUE_BODY_CHARS = 20_000

function clampTitle(title: string): string {
  const oneLine = title.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_TITLE ? `${oneLine.slice(0, MAX_TITLE - 1)}…` : oneLine
}

/** Chat title for a chat started from an issue, e.g. `#12 Fix the login redirect`. */
export function issueChatTitle(issue: { number: number; title: string }): string {
  return clampTitle(`#${issue.number} ${issue.title}`)
}

/** Chat title for a chat started from a PR/MR, e.g. `PR #34 Add dark mode`. */
export function prChatTitle(provider: RepoProvider, pr: { number: number; title: string }): string {
  const ref = provider === 'gitlab' ? `MR !${pr.number}` : `PR #${pr.number}`
  return clampTitle(`${ref} ${pr.title}`)
}

/**
 * Composer prefill for a chat started from an issue: number, title, URL and
 * body. It is only ever placed in the input for the user to review — the
 * body is third-party text, so it is quoted as data, not sent automatically.
 */
export function buildIssuePrompt(issue: IssueDetail): string {
  const body = issue.body.trim()
  const clipped =
    body.length > MAX_ISSUE_BODY_CHARS
      ? `${body.slice(0, MAX_ISSUE_BODY_CHARS)}\n\n[Issue body truncated — see the URL for the rest.]`
      : body
  const lines = [`Work on issue #${issue.number}: ${issue.title.replace(/\s+/g, ' ').trim()}`]
  if (issue.url) lines.push(issue.url)
  lines.push('', 'Issue description:', '', clipped.length > 0 ? clipped : '(no description)')
  return lines.join('\n')
}
