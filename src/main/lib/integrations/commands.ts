/**
 * Pure command parser for remote messaging integrations. The first
 * whitespace-delimited token is matched case-insensitively against the
 * command grammar; anything that isn't a recognized command is treated as a
 * plain prompt for the bound chat.
 */

export type Command =
  | { kind: 'help' }
  | { kind: 'projects' }
  | { kind: 'chats'; project: string }
  | { kind: 'use'; project: string; chat: string }
  | { kind: 'new'; project: string; title?: string }
  | { kind: 'status' }
  | { kind: 'unbind' }
  | { kind: 'approve' }
  | { kind: 'deny'; reason?: string }
  | { kind: 'prompt'; text: string }

export const HELP_TEXT = [
  'Commands (anything else is sent to the bound chat as a prompt):',
  'help — this list',
  'projects — list projects',
  'chats <project> — list chats in a project',
  'use <project> <chat> — bind this conversation to a chat',
  'new <project> [title] — create a chat (own worktree) and bind to it',
  'status — bound target, run state, pending approvals/questions',
  'unbind — remove this conversation\u2019s binding',
  'approve (or yes) — approve the oldest pending tool call',
  'deny [reason] (or no) — decline it, optionally with feedback'
].join('\n')

export function parseCommand(input: string): Command {
  const text = input.trim()
  if (!text) return { kind: 'prompt', text }
  const tokens = text.split(/\s+/)
  const first = tokens[0].toLowerCase()
  const rest = tokens.slice(1)

  switch (first) {
    case 'help':
      return { kind: 'help' }
    case 'projects':
      return { kind: 'projects' }
    case 'chats':
      if (rest.length === 0) return { kind: 'prompt', text }
      return { kind: 'chats', project: rest.join(' ') }
    case 'use':
      if (rest.length < 2) return { kind: 'prompt', text }
      return { kind: 'use', project: rest[0], chat: rest.slice(1).join(' ') }
    case 'new':
      if (rest.length === 0) return { kind: 'prompt', text }
      return {
        kind: 'new',
        project: rest[0],
        title: rest.length > 1 ? rest.slice(1).join(' ') : undefined
      }
    case 'status':
      return { kind: 'status' }
    case 'unbind':
      return { kind: 'unbind' }
    case 'approve':
      return { kind: 'approve' }
    case 'deny':
      return { kind: 'deny', reason: rest.length > 0 ? rest.join(' ') : undefined }
    // Bare yes/no only — "yes, let's try X" must stay a prompt/answer, never
    // an implicit approval of a pending tool call.
    case 'yes':
      if (rest.length === 0) return { kind: 'approve' }
      return { kind: 'prompt', text }
    case 'no':
      if (rest.length === 0) return { kind: 'deny' }
      return { kind: 'prompt', text }
    default:
      return { kind: 'prompt', text }
  }
}
