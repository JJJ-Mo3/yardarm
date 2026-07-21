/**
 * Renders an ask_user tool suspension: a question with optional single- or
 * multi-select options (or free text). Resumes with `string | string[]`
 * per the SDK's AskUserAnswer contract.
 */
import React, { useState } from 'react'
import { Check, MessageCircleQuestion } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'
import { Markdown } from './Markdown'
import type { PendingSuspension, ToolCallPart } from '../../../../shared/ui-message'

interface AskUserPayload {
  question?: string
  options?: Array<{ label: string; description?: string }>
  selectionMode?: 'single_select' | 'multi_select'
}

/**
 * The agent is instructed to mark its preferred option by suffixing the label
 * with "(Recommended)". Strip it for display and show a badge instead; the
 * resume payload keeps the original label the model wrote.
 */
const RECOMMENDED_RE = /\s*\(recommended\)\s*$/i

function RecommendedBadge(): React.JSX.Element {
  return (
    <span className="ml-1.5 inline-block rounded-full border border-violet-500/50 bg-violet-500/15 px-1.5 text-[9px] font-medium text-violet-400 align-middle">
      Recommended
    </span>
  )
}

export function AskUserCard({
  suspension,
  onResume
}: {
  suspension: PendingSuspension
  onResume: (resumeData: string | string[]) => void
}): React.JSX.Element {
  const payload = (suspension.suspendPayload ?? suspension.args ?? {}) as AskUserPayload
  const question = payload.question ?? 'The agent has a question.'
  const options = payload.options ?? []
  const multi = payload.selectionMode === 'multi_select'
  const [selected, setSelected] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')
  const [showOther, setShowOther] = useState(false)

  const toggle = (label: string): void => {
    if (multi) {
      setSelected((prev) =>
        prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
      )
    } else {
      onResume(label)
    }
  }

  return (
    <div className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <MessageCircleQuestion size={14} className="text-violet-400" />
        Question from the agent
      </div>
      <div className="max-h-60 overflow-y-auto selectable">
        <Markdown text={question} />
      </div>

      {options.length > 0 && !showOther && (
        <div className="space-y-1">
          {options.map((o) => {
            const active = selected.includes(o.label)
            const recommended = RECOMMENDED_RE.test(o.label)
            return (
              <button
                key={o.label}
                onClick={() => toggle(o.label)}
                className={cn(
                  'flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left cursor-pointer',
                  active
                    ? 'border-violet-500/60 bg-violet-500/10'
                    : 'border-border hover:bg-accent/50'
                )}
              >
                {multi && (
                  <span
                    className={cn(
                      'mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border text-[8px]',
                      active ? 'border-violet-500 bg-violet-500 text-white' : 'border-border'
                    )}
                  >
                    {active ? '✓' : ''}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="text-xs">{o.label.replace(RECOMMENDED_RE, '')}</span>
                  {recommended && <RecommendedBadge />}
                  {o.description && (
                    <span className="block text-[10px] text-muted-foreground">{o.description}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {(options.length === 0 || showOther) && (
        <div className="space-y-2">
          <Textarea
            autoFocus
            rows={2}
            placeholder="Type your answer…"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && freeText.trim()) {
                e.preventDefault()
                onResume(freeText.trim())
              }
            }}
          />
          <div className="flex gap-2">
            <Tip content="Send this answer to the agent">
              <span className="inline-flex">
                <Button
                  size="sm"
                  disabled={!freeText.trim()}
                  onClick={() => onResume(freeText.trim())}
                >
                  Answer
                </Button>
              </span>
            </Tip>
            {showOther && (
              <Tip content="Return to the agent's suggested options">
                <Button size="sm" variant="ghost" onClick={() => setShowOther(false)}>
                  Back to options
                </Button>
              </Tip>
            )}
          </div>
        </div>
      )}

      {options.length > 0 && !showOther && (
        <div className="flex gap-2">
          {multi && (
            <Tip content="Send the selected option(s) to the agent">
              <span className="inline-flex">
                <Button
                  size="sm"
                  disabled={selected.length === 0}
                  onClick={() => onResume(selected)}
                >
                  Answer{selected.length > 0 ? ` (${selected.length})` : ''}
                </Button>
              </span>
            </Tip>
          )}
          <Tip content="Answer in your own words instead of picking an option">
            <Button size="sm" variant="ghost" onClick={() => setShowOther(true)}>
              Other…
            </Button>
          </Tip>
        </div>
      )}
    </div>
  )
}

/**
 * Read-only history view of a resolved ask_user tool call: the question plus
 * the answer the user gave. The tool result is the string
 * "User answered: <answer>" — strip the prefix for display.
 */
export function AskUserAnswered({ part }: { part: ToolCallPart }): React.JSX.Element {
  const payload = (part.args ?? {}) as AskUserPayload
  const question = payload.question ?? 'The agent had a question.'
  const raw =
    typeof part.result === 'string'
      ? part.result
      : part.result != null
        ? JSON.stringify(part.result)
        : null
  // Strip the answer prefix and any trailing "(Recommended)" marker the
  // agent may have put in the chosen option's label.
  const answer = raw?.replace(/^User answered:\s*/, '').replace(RECOMMENDED_RE, '') ?? null
  const skipped = answer === '(skipped)'

  return (
    <div className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <MessageCircleQuestion size={14} className="text-violet-400" />
        Question from the agent
      </div>
      <div className="max-h-60 overflow-y-auto selectable">
        <Markdown text={question} />
      </div>
      {answer && !skipped ? (
        <div className="flex items-start gap-1.5 text-xs text-violet-400 selectable">
          <Check size={13} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{answer}</span>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">
          {skipped ? 'Skipped' : 'No answer recorded'}
        </div>
      )}
    </div>
  )
}
