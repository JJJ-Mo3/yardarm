/**
 * Details-panel widget: the most recent submitted plan in this thread,
 * extracted from the newest submit_plan tool call and rendered as Markdown.
 */
import React, { useMemo } from 'react'
import { Markdown } from '../Markdown'
import type { StoredMessage } from '../../../../../shared/ui-message'

/** Newest submit_plan plan text in the transcript, or null. */
function latestPlanText(messages: StoredMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i].parts) {
      if (part.type !== 'tool-call' || part.toolName !== 'submit_plan') continue
      const sources = [part.args, part.result]
      for (const src of sources) {
        if (typeof src === 'string' && src.trim()) return src
        if (src && typeof src === 'object') {
          const obj = src as Record<string, unknown>
          for (const key of ['plan', 'content', 'text', 'message', 'markdown']) {
            if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
              return obj[key] as string
            }
          }
        }
      }
    }
  }
  return null
}

export function PlanWidget({ messages }: { messages: StoredMessage[] }): React.JSX.Element {
  const plan = useMemo(() => latestPlanText(messages), [messages])
  if (!plan) {
    return <div className="text-[11px] text-muted-foreground">No plan submitted yet.</div>
  }
  return (
    <div className="[&_.markdown]:text-[11px]">
      <Markdown text={plan} />
    </div>
  )
}
