/**
 * Wiki Ask side panel: read-only codebase Q&A that runs in the project's
 * dedicated hidden "Codebase Q&A" chat (projects.ask_chat_id) and streams
 * right next to the wiki, so the pages stay visible and navigable while you
 * ask. Questions dispatch via chats.ask (marker send, forced YOLO — nobody
 * watches the hidden chat for approvals); answers render with the normal
 * MessageList so path:line citations stay clickable. Opened from the wiki
 * header Ask button or the sidebar footer (wikiAskOpenAtom).
 */
import React, { useState } from 'react'
import { Loader2, MessageCircleQuestion, Square, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'
import { MessageList } from '../agents/MessageList'
import { useAgentStream } from '../agents/use-agent-stream'

export function AskPanel({
  projectId,
  onClose
}: {
  projectId: string
  onClose: () => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const [question, setQuestion] = useState('')
  const [dismissedErrorTs, setDismissedErrorTs] = useState(0)

  // The persistent Q&A chat, when one exists; the first ask creates it.
  const target = trpc.chats.askTarget.useQuery({ projectId })
  const subchatId = target.data?.subchatId ?? null
  const stream = useAgentStream(subchatId)

  const ask = trpc.chats.ask.useMutation({
    onSuccess: () => {
      setQuestion('')
      void utils.chats.askTarget.invalidate({ projectId })
    }
  })
  const respondSuspension = trpc.agent.respondSuspension.useMutation()
  const abort = trpc.agent.abort.useMutation()

  const submit = (): void => {
    const q = question.trim()
    if (!q || ask.isPending) return
    ask.mutate({ projectId, question: q })
  }

  // The Q&A chat is hidden (no normal chat pane watches it), so surface the
  // newest run error here instead of letting it fail silently.
  const streamError = stream.infos
    .filter((i) => i.level === 'error' && i.ts > dismissedErrorTs)
    .at(-1)

  return (
    <div className="flex h-full w-[420px] shrink-0 flex-col border-l border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircleQuestion size={14} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">Ask about the codebase</span>
        </div>
        <Tip content="Close the Ask panel">
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X size={13} />
          </Button>
        </Tip>
      </div>

      {(ask.error || streamError) && (
        <div className="flex items-start justify-between gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5">
          <div className="selectable min-w-0 text-[11px] text-red-600 dark:text-red-400">
            {ask.error?.message ?? streamError?.text}
          </div>
          <Tip content="Dismiss this error">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                ask.reset()
                setDismissedErrorTs(Date.now())
              }}
            >
              <X size={12} />
            </Button>
          </Tip>
        </div>
      )}

      {subchatId ? (
        <MessageList
          messages={stream.messages}
          running={stream.running}
          suspensions={stream.suspensions}
          onRespondSuspension={(toolCallId, resumeData, toolName) =>
            respondSuspension.mutate({ subchatId, toolCallId, resumeData, toolName })
          }
          resetKey={subchatId}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <MessageCircleQuestion size={24} className="text-muted-foreground" />
          <div className="text-sm font-medium">Ask anything about this codebase</div>
          <div className="max-w-xs text-xs text-muted-foreground">
            The agent investigates read-only — nothing is created, modified, or deleted — and
            answers here with clickable <code className="text-foreground">path:line</code>{' '}
            citations, while the wiki stays open beside it.
          </div>
        </div>
      )}

      <div className="border-t border-border p-2">
        <Textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="e.g. How does rollback work? Where are API keys stored?"
        />
        <div className="mt-2 flex items-center justify-end gap-1.5">
          {stream.running && (
            <Tip content="Stop the current answer">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => subchatId && abort.mutate({ subchatId })}
              >
                <Square size={12} />
                Stop
              </Button>
            </Tip>
          )}
          <Tip content="Ask the question (Enter) — read-only, answers stream here">
            <span className="inline-flex">
              <Button size="sm" disabled={!question.trim() || ask.isPending} onClick={submit}>
                {ask.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <MessageCircleQuestion size={13} />
                )}
                Ask
              </Button>
            </span>
          </Tip>
        </div>
      </div>
    </div>
  )
}
