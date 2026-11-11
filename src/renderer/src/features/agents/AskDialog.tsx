/**
 * Ask-about-the-codebase dialog: collects a question and runs it as a
 * read-only Q&A in its own new chat (chats.ask — no worktree, marker send),
 * then navigates to that chat so the answer streams in the normal chat pane
 * with clickable path:line citations. Opened from the sidebar footer Ask
 * button and the Repo wiki header; no chat needs to be selected first.
 */
import React, { useState } from 'react'
import { useSetAtom } from 'jotai'
import { Loader2, MessageCircleQuestion } from 'lucide-react'
import { mainTabAtom } from '../../lib/atoms'
import { trpc } from '../../lib/trpc'
import { useSelectChat } from '../../lib/use-select-chat'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'

export function AskDialog({
  projectId,
  open,
  onOpenChange
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const setTab = useSetAtom(mainTabAtom)
  const selectChat = useSelectChat()
  const [question, setQuestion] = useState('')

  const ask = trpc.chats.ask.useMutation({
    onSuccess: ({ chatId }) => {
      void utils.chats.list.invalidate({ projectId })
      selectChat(chatId)
      setTab('chat')
      setQuestion('')
      onOpenChange(false)
    }
  })

  const submit = (): void => {
    const q = question.trim()
    if (!q || ask.isPending) return
    ask.mutate({ projectId, question: q })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) ask.reset()
      }}
    >
      <DialogContent>
        <DialogTitle className="flex items-center gap-2">
          <MessageCircleQuestion size={14} />
          Ask about the codebase
        </DialogTitle>
        <DialogDescription className="mb-3">
          The agent investigates read-only — nothing is created, modified, or deleted — and answers
          in a new chat with clickable <code className="text-foreground">path:line</code> citations.
        </DialogDescription>
        <Textarea
          autoFocus
          rows={3}
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
        {ask.error && (
          <div className="mt-2 text-[11px] text-destructive selectable">{ask.error.message}</div>
        )}
        <div className="mt-3 flex justify-end">
          <Tip content="Run the question in its own new chat (Enter)">
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
      </DialogContent>
    </Dialog>
  )
}
