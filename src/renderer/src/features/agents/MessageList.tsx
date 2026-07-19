import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Markdown } from './Markdown'
import { ToolCallCard } from './ToolCallCard'
import { AskUserCard, AskUserAnswered } from './AskUserCard'
import { PlanApprovalCard, PlanApprovalAnswered } from './PlanApprovalCard'
import { SandboxAccessCard, SandboxAccessAnswered } from './SandboxAccessCard'
import type {
  MessagePart,
  PendingSuspension,
  StoredMessage,
  ToolCallPart
} from '../../../../shared/ui-message'

/**
 * Suspension-based tools rendered as interactive inline cards (pending) or
 * readable Q&A summaries (answered) instead of the generic wrench row.
 * ChatView uses this to keep such suspensions out of the bottom gates strip.
 */
export const INTERACTIVE_TOOLS = new Set(['ask_user', 'submit_plan', 'request_access'])

interface SuspensionProps {
  suspensions?: PendingSuspension[]
  onRespondSuspension?: (toolCallId: string, resumeData: unknown) => void
}

function InteractiveToolPart({
  part,
  suspensions,
  onRespondSuspension
}: { part: ToolCallPart } & SuspensionProps): React.JSX.Element {
  const live = suspensions?.find((s) => s.toolCallId === part.toolCallId)
  if (live && onRespondSuspension) {
    const respond = (resumeData: unknown): void => onRespondSuspension(live.toolCallId, resumeData)
    return (
      <div className="my-1">
        {part.toolName === 'ask_user' ? (
          <AskUserCard suspension={live} onResume={respond} />
        ) : part.toolName === 'submit_plan' ? (
          <PlanApprovalCard suspension={live} onResume={respond} />
        ) : (
          <SandboxAccessCard suspension={live} onResume={respond} />
        )}
      </div>
    )
  }
  return (
    <div className="my-1">
      {part.toolName === 'ask_user' ? (
        <AskUserAnswered part={part} />
      ) : part.toolName === 'submit_plan' ? (
        <PlanApprovalAnswered part={part} />
      ) : (
        <SandboxAccessAnswered part={part} />
      )}
    </div>
  )
}

function ReasoningBlock({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={11} />
        Thinking
      </button>
      {open && (
        <div className="mt-1 border-l-2 border-border pl-3 text-muted-foreground selectable">
          <Markdown text={text} />
        </div>
      )}
    </div>
  )
}

function Part({
  part,
  suspensions,
  onRespondSuspension
}: { part: MessagePart } & SuspensionProps): React.JSX.Element | null {
  switch (part.type) {
    case 'text':
      return <Markdown text={part.text} />
    case 'reasoning':
      return <ReasoningBlock text={part.text} />
    case 'tool-call':
      if (INTERACTIVE_TOOLS.has(part.toolName)) {
        return (
          <InteractiveToolPart
            part={part}
            suspensions={suspensions}
            onRespondSuspension={onRespondSuspension}
          />
        )
      }
      return <ToolCallCard part={part} />
    case 'info':
      return (
        <div
          className={cn(
            'text-xs rounded px-2 py-1 my-1',
            part.level === 'error' ? 'text-destructive bg-destructive/10' : 'text-muted-foreground'
          )}
        >
          {part.text}
        </div>
      )
    default:
      return null
  }
}

function MessageItem({
  message,
  onRollback,
  hiddenParts,
  suspensions,
  onRespondSuspension
}: {
  message: StoredMessage
  onRollback?: (messageId: string) => void
  hiddenParts?: Set<string>
} & SuspensionProps): React.JSX.Element {
  if (message.role === 'user') {
    const text = message.parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
    return (
      <div className="flex justify-end group">
        <div className="relative max-w-[85%] rounded-lg bg-accent border border-border px-3 py-2 selectable whitespace-pre-wrap text-[13px]">
          {text}
          {onRollback && message.checkpointRef && (
            <button
              title="Restore files and chat to just before this message was sent — its text returns to the input for editing"
              onClick={() => onRollback(message.id)}
              className="absolute right-full top-1.5 mr-1.5 flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm opacity-70 group-hover:opacity-100 hover:opacity-100 hover:text-foreground cursor-pointer"
            >
              <RotateCcw size={10} />
              Roll back to before this message
            </button>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="max-w-full">
      {message.parts.map((part, i) =>
        hiddenParts?.has(`${message.id}:${i}`) ? null : (
          <Part
            key={i}
            part={part}
            suspensions={suspensions}
            onRespondSuspension={onRespondSuspension}
          />
        )
      )}
    </div>
  )
}

export function MessageList({
  messages,
  running,
  onRollback,
  suspensions,
  onRespondSuspension
}: {
  messages: StoredMessage[]
  running: boolean
  onRollback?: (messageId: string) => void
} & SuspensionProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // A streamed tool call can transiently exist in two messages (it attaches
  // to the current assistant message before mastracode homes it elsewhere).
  // Interactive cards must render exactly once, so hide every occurrence of
  // an interactive toolCallId except the last one.
  const hiddenParts = useMemo(() => {
    const lastLoc = new Map<string, string>()
    const locs: Array<[string, string]> = [] // [toolCallId, "msgId:partIdx"]
    for (const m of messages) {
      m.parts.forEach((p, i) => {
        if (p.type === 'tool-call' && INTERACTIVE_TOOLS.has(p.toolName)) {
          const key = `${m.id}:${i}`
          lastLoc.set(p.toolCallId, key)
          locs.push([p.toolCallId, key])
        }
      })
    }
    const hidden = new Set<string>()
    for (const [toolCallId, key] of locs) {
      if (lastLoc.get(toolCallId) !== key) hidden.add(key)
    }
    return hidden
  }, [messages])

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [messages, running])

  return (
    <div
      ref={containerRef}
      onScroll={() => {
        const el = containerRef.current
        if (!el) return
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      }}
      className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
    >
      {messages.length === 0 && !running && (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          Start a conversation with the agent
        </div>
      )}
      {messages.map((m) => (
        <MessageItem
          key={m.id}
          message={m}
          onRollback={onRollback}
          hiddenParts={hiddenParts}
          suspensions={suspensions}
          onRespondSuspension={onRespondSuspension}
        />
      ))}
      {running && (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span className="inline-block h-2 w-2 rounded-full bg-foreground/60 animate-pulse" />
          Working…
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
