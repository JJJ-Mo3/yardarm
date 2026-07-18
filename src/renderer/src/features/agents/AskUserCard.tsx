/**
 * Renders an ask_user tool suspension: a question with optional single- or
 * multi-select options (or free text). Resumes with `string | string[]`
 * per the SDK's AskUserAnswer contract.
 */
import React, { useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { cn } from '../../lib/utils'
import { Markdown } from './Markdown'
import type { PendingSuspension } from '../../../../shared/ui-message'

interface AskUserPayload {
  question?: string
  options?: Array<{ label: string; description?: string }>
  selectionMode?: 'single_select' | 'multi_select'
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
                  <span className="text-xs">{o.label}</span>
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
            <Button size="sm" disabled={!freeText.trim()} onClick={() => onResume(freeText.trim())}>
              Answer
            </Button>
            {showOther && (
              <Button size="sm" variant="ghost" onClick={() => setShowOther(false)}>
                Back to options
              </Button>
            )}
          </div>
        </div>
      )}

      {options.length > 0 && !showOther && (
        <div className="flex gap-2">
          {multi && (
            <Button size="sm" disabled={selected.length === 0} onClick={() => onResume(selected)}>
              Answer{selected.length > 0 ? ` (${selected.length})` : ''}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowOther(true)}>
            Other…
          </Button>
        </div>
      )}
    </div>
  )
}
