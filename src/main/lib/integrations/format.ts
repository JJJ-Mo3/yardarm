/**
 * Pure formatting helpers for remote messaging integrations: extracting the
 * final assistant text from stored messages, converting the agent's markdown
 * to each platform's dialect (Slack mrkdwn vs Discord markdown), and building
 * the relayed approval/question messages.
 */
import type { IntegrationPlatform } from '../../../shared/integrations'
import type { StoredMessage } from '../../../shared/ui-message'

/** Concatenate the text parts (markers excluded) of the last assistant message. */
export function extractFinalText(messages: StoredMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    const text = msg.parts
      .map((p) => (p.type === 'text' && !p.marker ? p.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

/**
 * Convert the agent's GitHub-flavored markdown to Slack mrkdwn: *bold* uses
 * single asterisks, links are <url|text>, headings become bold lines.
 * Fenced/inline code spans are preserved untouched.
 */
function toSlackMrkdwn(text: string): string {
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg // code span/fence — leave as-is
      return seg
        .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')
        .replace(/\*\*([^*]+)\*\*/g, '*$1*')
        .replace(/~~([^~]+)~~/g, '~$1~')
    })
    .join('')
}

/** Convert agent markdown to the given platform's dialect. */
export function formatForPlatform(text: string, platform: IntegrationPlatform): string {
  // Discord speaks GitHub-flavored markdown natively.
  return platform === 'slack' ? toSlackMrkdwn(text) : text
}

const ARGS_MAX = 600

/** Compact single-line JSON of tool args, truncated for chat display. */
export function compactArgs(args: unknown): string {
  let json: string
  try {
    json = JSON.stringify(args) ?? 'null'
  } catch {
    json = String(args)
  }
  if (json.length > ARGS_MAX) json = json.slice(0, ARGS_MAX) + '…'
  return json
}

/** Message relayed for a pending tool approval. */
export function formatApprovalMessage(toolName: string, args: unknown): string {
  return [
    `Approval needed: \`${toolName}\``,
    '```',
    compactArgs(args),
    '```',
    'Reply "approve" to allow or "deny [reason]" to decline.'
  ].join('\n')
}

interface AskUserPayload {
  question?: string
  options?: Array<{ label?: string; description?: string }>
}

/** Message relayed for a pending agent question (ask_user suspension). */
export function formatQuestionMessage(suspendPayload: unknown): string {
  const payload = (suspendPayload ?? {}) as AskUserPayload
  const lines = ['Question from the agent:', payload.question?.trim() || '(no question text)']
  const options = Array.isArray(payload.options) ? payload.options : []
  if (options.length > 0) {
    lines.push('')
    for (const o of options) {
      if (!o?.label) continue
      lines.push(o.description ? `• ${o.label} — ${o.description}` : `• ${o.label}`)
    }
  }
  lines.push('', 'Reply with your answer.')
  return lines.join('\n')
}
