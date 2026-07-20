import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'
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

/**
 * Tools known to never change project files. Any other tool (write/edit/
 * delete/mkdir/execute_command/subagent, MCP and plugin tools) is treated as
 * change-capable, which decides whether a user message shows a rollback pill.
 */
const READONLY_TOOLS = new Set([
  'view',
  'find_files',
  'file_stat',
  'search_content',
  'lsp_inspect',
  'get_process_output',
  'kill_process',
  'web_search',
  'web-search',
  'web_extract',
  'web-extract',
  'notification_inbox',
  'ask_user',
  'submit_plan',
  'request_access',
  'task_write',
  'task_update',
  'task_complete',
  'task_check'
])

interface SuspensionProps {
  suspensions?: PendingSuspension[]
  onRespondSuspension?: (toolCallId: string, resumeData: unknown) => void
}

/** Messages rendered before the user asks for earlier history. */
const INITIAL_VISIBLE = 100
const EXPAND_STEP = 200

/**
 * Returns the previous Set reference when the contents are unchanged, so
 * memoized message items don't re-render on every streaming upsert just
 * because a freshly-built (but equal) Set was passed down.
 */
function useStableSet(next: Set<string>): Set<string> {
  const prev = useRef(next)
  const same =
    prev.current === next ||
    (prev.current.size === next.size && [...next].every((v) => prev.current.has(v)))
  if (!same) prev.current = next
  return prev.current
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
      <Tip
        content={
          open
            ? "Hide the model's reasoning"
            : "Show the model's step-by-step reasoning for this reply"
        }
      >
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Brain size={11} />
          Thinking
        </button>
      </Tip>
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

// Memoized: with stable props (reducer preserves untouched message refs,
// useStableSet keeps Set identities) a streaming upsert re-renders only the
// one message that changed instead of the entire transcript.
const MessageItem = React.memo(function MessageItem({
  message,
  onRollback,
  showRollback,
  hiddenParts,
  suspensions,
  onRespondSuspension
}: {
  message: StoredMessage
  onRollback?: (messageId: string) => void
  showRollback?: boolean
  hiddenParts?: Set<string>
} & SuspensionProps): React.JSX.Element {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return (
      <div className="flex justify-end group">
        <div className="relative max-w-[85%] rounded-lg bg-accent border border-border px-3 py-2 selectable whitespace-pre-wrap text-[13px]">
          {text}
          {onRollback && message.checkpointRef && showRollback && (
            <Tip content="Restore files and chat to just before this message was sent — its text returns to the input for editing">
              <button
                onClick={() => onRollback(message.id)}
                className="absolute right-full top-1.5 mr-1.5 flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm opacity-70 group-hover:opacity-100 hover:opacity-100 hover:text-foreground cursor-pointer"
              >
                <RotateCcw size={10} />
                Roll back to before this message
              </button>
            </Tip>
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
})

export function MessageList({
  messages,
  running,
  onRollback,
  resetKey,
  suspensions,
  onRespondSuspension
}: {
  messages: StoredMessage[]
  running: boolean
  onRollback?: (messageId: string) => void
  /** Changes when the transcript identity changes (e.g. subchat switch). */
  resetKey?: string
} & SuspensionProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Bounded initial render: long transcripts show the most recent slice and
  // an expander, keeping streaming re-renders and first paint cheap.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE)
    stickToBottom.current = true
  }, [resetKey])

  // Preserve the viewport position when older messages are prepended.
  const prevScrollHeight = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (prevScrollHeight.current === null) return
    const el = containerRef.current
    if (el) el.scrollTop += el.scrollHeight - prevScrollHeight.current
    prevScrollHeight.current = null
  }, [visibleCount])

  // A streamed tool call can transiently exist in two messages (it attaches
  // to the current assistant message before mastracode homes it elsewhere).
  // Interactive cards must render exactly once, so hide every occurrence of
  // an interactive toolCallId except the last one. Computed over the FULL
  // array (not the visible slice) so dedupe stays correct across the
  // visibility boundary.
  const hiddenParts = useStableSet(
    useMemo(() => {
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
  )

  // A rollback pill is only meaningful when rolling back would revert
  // something: show it on a user message iff a change-capable tool ran in
  // any later message. Reverse scan: cheap and updates live as tools stream.
  const rollbackEligible = useStableSet(
    useMemo(() => {
      const eligible = new Set<string>()
      let anyChangeAfter = false
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'user') {
          if (anyChangeAfter) eligible.add(m.id)
        } else if (!anyChangeAfter) {
          anyChangeAfter = m.parts.some(
            (p) => p.type === 'tool-call' && !READONLY_TOOLS.has(p.toolName)
          )
        }
      }
      return eligible
    }, [messages])
  )

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [messages, running])

  const visible = messages.length > visibleCount ? messages.slice(-visibleCount) : messages
  const earlierCount = messages.length - visible.length

  return (
    <div
      ref={containerRef}
      onScroll={() => {
        const el = containerRef.current
        if (!el) return
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      }}
      className="flex-1 overflow-y-auto px-14 py-3 space-y-3"
    >
      {messages.length === 0 && !running && (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          Start a conversation with the agent
        </div>
      )}
      {earlierCount > 0 && (
        <div className="flex justify-center">
          <Tip content="Render older messages that are hidden to keep long transcripts fast">
            <button
              onClick={() => {
                prevScrollHeight.current = containerRef.current?.scrollHeight ?? null
                setVisibleCount((c) => c + EXPAND_STEP)
              }}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm hover:text-foreground cursor-pointer"
            >
              Show earlier messages ({earlierCount} more)
            </button>
          </Tip>
        </div>
      )}
      {visible.map((m) => (
        <MessageItem
          key={m.id}
          message={m}
          onRollback={onRollback}
          showRollback={rollbackEligible.has(m.id)}
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
