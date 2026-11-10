/**
 * Save/dismiss card for an agent-proposed knowledge note. The agent ends a
 * reply with a "Suggested knowledge: <note>" line (see SUGGEST_KNOWLEDGE_GUIDANCE
 * in shared/knowledge-notes.ts); MessageList strips that line from the prose
 * and renders this card under the last assistant message instead. Saving
 * creates an unpinned note with source 'suggested' in the project's
 * Knowledge tab; dismissing is renderer-local (per message id, not persisted).
 */
import React, { useState } from 'react'
import { atom, useAtom, useAtomValue } from 'jotai'
import { Lightbulb, X } from 'lucide-react'
import { MAX_NOTE_BODY_CHARS, MAX_NOTE_TITLE_CHARS } from '@shared/knowledge-notes'
import { trpc } from '../../lib/trpc'
import { selectedProjectIdAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'

/** Message ids whose suggestion card was dismissed or saved (session-local). */
const dismissedSuggestionsAtom = atom<ReadonlySet<string>>(new Set<string>())

function defaultTitle(suggestion: string): string {
  const firstLine = suggestion.split('\n')[0].trim()
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine
}

export function SuggestedKnowledgeCard({
  messageId,
  suggestion
}: {
  messageId: string
  suggestion: string
}): React.JSX.Element | null {
  const [dismissed, setDismissed] = useAtom(dismissedSuggestionsAtom)
  const projectId = useAtomValue(selectedProjectIdAtom)
  const projects = trpc.projects.list.useQuery()
  const utils = trpc.useUtils()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(() => defaultTitle(suggestion))
  const [body, setBody] = useState(suggestion)

  const dismiss = (): void => setDismissed(new Set([...dismissed, messageId]))
  const create = trpc.knowledgeNotes.create.useMutation({
    onSuccess: () => {
      if (projectId) void utils.knowledgeNotes.list.invalidate({ projectId })
      dismiss()
    }
  })

  if (dismissed.has(messageId)) return null
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const canSave = !!project && !!title.trim() && !!body.trim() && !create.isPending

  return (
    <div className="max-w-xl space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Lightbulb size={12} />
        Suggested knowledge
        <span className="flex-1" />
        <Tip content="Dismiss this suggestion (nothing is saved)">
          <button
            onClick={dismiss}
            className="flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X size={12} />
          </button>
        </Tip>
      </div>
      {editing ? (
        <div className="space-y-2">
          <Input
            value={title}
            maxLength={MAX_NOTE_TITLE_CHARS}
            placeholder="Title"
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            value={body}
            maxLength={MAX_NOTE_BODY_CHARS}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-xs selectable">{suggestion}</div>
      )}
      <div className="flex items-center gap-2">
        <Tip
          content={
            project
              ? 'Save as an unpinned knowledge note (Project settings → Knowledge). Running chats in this project restart'
              : 'Select a project first'
          }
        >
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!canSave}
              onClick={() => {
                if (!project) return
                create.mutate({
                  projectId: project.id,
                  projectPath: project.path,
                  title: title.trim(),
                  body: body.trim(),
                  pinned: false,
                  source: 'suggested'
                })
              }}
            >
              {create.isPending ? 'Saving…' : 'Save note'}
            </Button>
          </span>
        </Tip>
        {!editing && (
          <Tip content="Adjust the title or wording before saving">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </Tip>
        )}
        {create.error && (
          <span className="text-[11px] text-destructive selectable">{create.error.message}</span>
        )}
      </div>
    </div>
  )
}
