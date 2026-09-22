/**
 * Chat transcript → Markdown export. Text and reasoning become prose, tool
 * calls become one-line blockquotes, and the result downloads as a .md file.
 */

import type { StoredMessage } from '../../../../shared/ui-message'

export function exportChatMarkdown(messages: StoredMessage[], title: string): string {
  const lines: string[] = [`# ${title}`, '']
  for (const m of messages) {
    lines.push(m.role === 'user' ? '## User' : '## Assistant', '')
    for (const part of m.parts) {
      switch (part.type) {
        case 'text':
          if (part.text.trim()) lines.push(part.text.trim(), '')
          break
        case 'reasoning':
          if (part.text.trim()) lines.push('> _Thinking_', ...quote(part.text), '')
          break
        case 'tool-call': {
          const summary = summarizeArgs(part.args)
          lines.push(`> \`${part.toolName}\`${summary ? ` — ${summary}` : ''} (${part.status})`, '')
          break
        }
        case 'info':
          lines.push(`> ${part.level === 'error' ? 'Error: ' : ''}${part.text}`, '')
          break
      }
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

function quote(text: string): string[] {
  return text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
}

/** Compact single-line rendering of tool args for the blockquote. */
function summarizeArgs(args: unknown): string {
  if (args == null) return ''
  try {
    const json = typeof args === 'string' ? args : JSON.stringify(args)
    const flat = json.replace(/\s+/g, ' ')
    return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat
  } catch {
    return ''
  }
}

/** Trigger a browser download of the transcript as a Markdown file. */
export function downloadChatMarkdown(messages: StoredMessage[], title: string): void {
  const md = exportChatMarkdown(messages, title)
  const safe = title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'chat'
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.md`
  a.click()
  URL.revokeObjectURL(url)
}
