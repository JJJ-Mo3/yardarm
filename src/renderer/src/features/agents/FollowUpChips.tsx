/**
 * Clickable next-step chips for the agent's "Follow-up: <step>" markers (see
 * FOLLOW_UP_GUIDANCE in shared/follow-ups.ts). MessageList strips the marker
 * lines from the prose and renders this row under the last assistant message
 * when the run is idle. Clicking a chip prefills the composer via
 * composerInsertAtom — it never auto-sends. Dismissal is renderer-local (per
 * message id, not persisted).
 */
import React from 'react'
import { atom, useAtom, useSetAtom } from 'jotai'
import { ArrowRight, X } from 'lucide-react'
import { composerInsertAtom } from '../../lib/atoms'
import { Tip } from '../../components/ui/tooltip'

/** Message ids whose follow-up row was dismissed (session-local). */
const dismissedFollowUpsAtom = atom<ReadonlySet<string>>(new Set<string>())

export function FollowUpChips({
  messageId,
  followUps
}: {
  messageId: string
  followUps: string[]
}): React.JSX.Element | null {
  const [dismissed, setDismissed] = useAtom(dismissedFollowUpsAtom)
  const setComposerInsert = useSetAtom(composerInsertAtom)

  if (dismissed.has(messageId) || followUps.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {followUps.map((step) => (
        <Tip key={step} content="Put this next step in the composer (nothing is sent until you do)">
          <button
            onClick={() => setComposerInsert(step)}
            className="flex max-w-md items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <ArrowRight size={11} className="shrink-0" />
            <span className="truncate" title={step}>
              {step}
            </span>
          </button>
        </Tip>
      ))}
      <Tip content="Hide these suggestions">
        <button
          onClick={() => setDismissed(new Set([...dismissed, messageId]))}
          className="flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <X size={12} />
        </button>
      </Tip>
    </div>
  )
}
