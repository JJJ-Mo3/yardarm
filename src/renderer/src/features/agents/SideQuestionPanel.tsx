/**
 * Side-question panel (`/btw` or the composer's "btw" button): a compact
 * column beside a chat that answers quick questions ABOUT that chat without
 * adding anything to its thread. Questions run in the chat's hidden helper
 * conversation (sideQuestion.ask — seeded with a digest of the chat's recent
 * messages, read-only, forced auto-approve since nothing else watches it);
 * the answer streams here, follow-ups continue the same side conversation,
 * and closing the panel keeps it for later.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircleQuestion, Square, Trash2, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { MessageList } from './MessageList'
import { useAgentStream } from './use-agent-stream'

export function SideQuestionPanel({
  subchatId,
  ask: pendingAsk,
  onAskConsumed,
  onClose
}: {
  /** The main conversation the questions are about. */
  subchatId: string
  /** A question handed over by `/btw <question>`; `seq` distinguishes repeats. */
  ask: { text: string; seq: number } | null
  onAskConsumed: () => void
  onClose: () => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const [question, setQuestion] = useState('')
  const [dismissedErrorTs, setDismissedErrorTs] = useState(0)

  // The side conversation, when one exists; the first question creates it.
  const target = trpc.sideQuestion.target.useQuery({ subchatId })
  const sideSubchatId = target.data?.subchatId ?? null
  const stream = useAgentStream(sideSubchatId)

  const ask = trpc.sideQuestion.ask.useMutation({
    onSuccess: () => void utils.sideQuestion.target.invalidate({ subchatId })
  })
  const clear = trpc.sideQuestion.clear.useMutation({
    onSuccess: () => void utils.sideQuestion.target.invalidate({ subchatId })
  })
  const respondSuspension = trpc.agent.respondSuspension.useMutation()
  const abort = trpc.agent.abort.useMutation()

  // `/btw <question>` asks immediately — once per handed-over question.
  const { mutate: askMutate } = ask
  const handledSeq = useRef(0)
  useEffect(() => {
    if (!pendingAsk || pendingAsk.seq === handledSeq.current) return
    handledSeq.current = pendingAsk.seq
    askMutate({ subchatId, question: pendingAsk.text })
    onAskConsumed()
  }, [pendingAsk, subchatId, askMutate, onAskConsumed])

  const submit = (): void => {
    const q = question.trim()
    if (!q || ask.isPending) return
    ask.mutate({ subchatId, question: q }, { onSuccess: () => setQuestion('') })
  }

  const onClear = (): void => {
    void confirmDialog({
      title: 'Clear the side conversation?',
      description:
        'The side questions and answers for this chat are permanently deleted. The chat itself ' +
        'is not affected.',
      confirmLabel: 'Clear'
    }).then((ok) => {
      if (ok) clear.mutate({ subchatId })
    })
  }

  // The helper chat is hidden (no chat pane watches it), so surface its
  // newest run error here instead of letting it fail silently.
  const streamError = stream.infos
    .filter((i) => i.level === 'error' && i.ts > dismissedErrorTs)
    .at(-1)
  const errorText =
    ask.error?.message ??
    clear.error?.message ??
    respondSuspension.error?.message ??
    abort.error?.message ??
    target.error?.message ??
    streamError?.text

  return (
    <div className="flex h-full w-[400px] shrink-0 flex-col border-l border-border">
      <div className="flex items-center justify-between gap-1 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircleQuestion size={14} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">Side question</span>
        </div>
        <div className="flex shrink-0 items-center">
          {sideSubchatId && (
            <Tip content="Clear this chat's side conversation (asks first; the chat itself is untouched)">
              <span className="inline-flex">
                <Button
                  aria-label="Clear side conversation"
                  size="icon"
                  variant="ghost"
                  disabled={clear.isPending || stream.running}
                  onClick={onClear}
                >
                  <Trash2 size={13} />
                </Button>
              </span>
            </Tip>
          )}
          <Tip content="Close the side panel — the side conversation is kept for later">
            <Button aria-label="Close side panel" size="icon" variant="ghost" onClick={onClose}>
              <X size={13} />
            </Button>
          </Tip>
        </div>
      </div>

      {errorText && (
        <div className="flex items-start justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5">
          <div className="selectable min-w-0 text-xs text-destructive">{errorText}</div>
          <Tip content="Dismiss this error">
            <Button
              aria-label="Dismiss error"
              size="icon"
              variant="ghost"
              onClick={() => {
                ask.reset()
                clear.reset()
                respondSuspension.reset()
                abort.reset()
                setDismissedErrorTs(Date.now())
              }}
            >
              <X size={12} />
            </Button>
          </Tip>
        </div>
      )}

      {sideSubchatId ? (
        <MessageList
          messages={stream.messages}
          running={stream.running}
          suspensions={stream.suspensions}
          onRespondSuspension={(toolCallId, resumeData, toolName) =>
            respondSuspension.mutate({
              subchatId: sideSubchatId,
              toolCallId,
              resumeData,
              toolName
            })
          }
          resetKey={sideSubchatId}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {ask.isPending ? (
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          ) : (
            <MessageCircleQuestion size={24} className="text-muted-foreground" />
          )}
          <div className="text-sm font-medium">Ask about this chat, on the side</div>
          <div className="max-w-xs text-xs text-muted-foreground">
            A quick question about what is happening in this chat — answered here from its recent
            messages, read-only. Nothing is added to the chat’s thread and the agent is not
            interrupted.
          </div>
        </div>
      )}

      <div className="border-t border-border p-2">
        <Textarea
          rows={2}
          value={question}
          aria-label="Side question"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="e.g. Why did it change that file? What is it doing right now?"
        />
        <div className="mt-2 flex items-center justify-end gap-1.5">
          {stream.running && (
            <Tip content="Stop the current side answer (the main chat keeps running)">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => sideSubchatId && abort.mutate({ subchatId: sideSubchatId })}
              >
                <Square size={12} />
                Stop
              </Button>
            </Tip>
          )}
          <Tip content="Ask the side question (Enter) — follow-ups continue the same side conversation">
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
