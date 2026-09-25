/**
 * Pure detection of git activity (commits, pushes, merges, branch switches)
 * inside an assistant message's successful shell tool calls. Backs the muted
 * GitActivityBadges row rendered under assistant turns in MessageList.
 */
import type { StoredMessage } from '../../../../shared/ui-message'

export interface GitActivity {
  commits: number
  pushes: number
  merges: number
  /** Branch the turn ended up on via checkout/switch, when detectable. */
  branchSwitch: string | null
}

/** Shell-executing tool names whose args carry a `command` string. */
const SHELL_TOOLS = new Set(['execute_command', 'bash', 'shell', 'run_command'])

/** Extracts the branch target of a checkout/switch, or null for file restores. */
function branchTarget(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    // `checkout -- <path>` restores files; it is not a branch switch.
    if (t === '--') return null
    if (t === '-b' || t === '-B' || t === '-c') return tokens[i + 1] ?? null
    if (t.startsWith('-')) continue
    // Bare path specs (`checkout .`) are file restores too.
    return t === '.' ? null : t
  }
  return null
}

/** Classifies one simple command (already split off chains) into activity. */
function classify(rawSegment: string, activity: GitActivity): void {
  // Strip leading env assignments (FOO=bar git …).
  const s = rawSegment.trim().replace(/^(?:\w+=\S*\s+)+/, '')
  if (!/^git(?:\s|$)/.test(s)) return
  const tokens = s.split(/\s+/).slice(1)
  // Skip global flags before the subcommand: -C <dir> and -c k=v take a
  // value; other dash flags (--no-pager, …) stand alone.
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === '-C' || t === '-c') {
      i += 2
      continue
    }
    if (t.startsWith('-')) {
      i++
      continue
    }
    break
  }
  const sub = tokens[i]
  const rest = tokens.slice(i + 1)
  switch (sub) {
    case 'commit':
      activity.commits++
      break
    case 'push':
      activity.pushes++
      break
    case 'merge':
      if (!rest.includes('--abort') && !rest.includes('--continue')) activity.merges++
      break
    case 'checkout':
    case 'switch': {
      const target = branchTarget(rest)
      if (target) activity.branchSwitch = target
      break
    }
  }
}

/**
 * Scans a message's successful shell tool calls for git commits, pushes,
 * merges and branch switches. Returns null when the turn had none.
 */
export function detectGitActivity(message: StoredMessage): GitActivity | null {
  const activity: GitActivity = { commits: 0, pushes: 0, merges: 0, branchSwitch: null }
  for (const part of message.parts) {
    if (part.type !== 'tool-call') continue
    if (!SHELL_TOOLS.has(part.toolName)) continue
    if (part.status !== 'success') continue
    const args = part.args
    const command =
      args && typeof args === 'object' ? (args as { command?: unknown }).command : undefined
    if (typeof command !== 'string') continue
    // Split chained commands; quoted separators may over-split, but the
    // extra fragments never start with `git` so they classify as noise.
    for (const segment of command.split(/&&|\|\||;|\||\n/)) classify(segment, activity)
  }
  return activity.commits > 0 || activity.pushes > 0 || activity.merges > 0 || activity.branchSwitch
    ? activity
    : null
}
