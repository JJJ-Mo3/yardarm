import React, { useState } from 'react'
import { Check, ClipboardList, Undo2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'
import { Markdown } from './Markdown'
import type { PendingSuspension, ToolCallPart } from '../../../../shared/ui-message'

function extractPlanText(suspension: PendingSuspension): string | null {
  const sources = [suspension.suspendPayload, suspension.args]
  for (const src of sources) {
    if (typeof src === 'string' && src.trim()) return src
    if (src && typeof src === 'object') {
      const obj = src as Record<string, unknown>
      for (const key of ['plan', 'content', 'text', 'message', 'markdown']) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) return obj[key] as string
      }
    }
  }
  return null
}

/**
 * Plan identity fields echoed back in submit_plan resumes (what the CLI
 * sends) so the tool result carries the plan title/path for history views.
 */
function planResumeRefs(suspension: PendingSuspension): {
  path?: string
  title?: string
  plan?: string
} {
  const refs: { path?: string; title?: string; plan?: string } = {}
  const payload = suspension.suspendPayload
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const key of ['path', 'title', 'plan'] as const) {
      const value = obj[key]
      if (typeof value === 'string' && value) refs[key] = value
    }
  }
  return refs
}

export function PlanApprovalCard({
  suspension,
  onResume
}: {
  suspension: PendingSuspension
  onResume: (resumeData: unknown) => void
}): React.JSX.Element {
  const isPlan = suspension.toolName === 'submit_plan'
  const planText = extractPlanText(suspension)
  const [feedback, setFeedback] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [rawJson, setRawJson] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)

  return (
    <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <ClipboardList size={14} className="text-blue-400" />
        {isPlan ? 'Plan ready for review' : `${suspension.toolName} needs input`}
      </div>
      {planText ? (
        <div className="max-h-96 overflow-y-auto rounded bg-muted p-3 selectable">
          <Markdown text={planText} />
        </div>
      ) : (
        <pre className="text-[11px] font-mono bg-muted rounded p-2 overflow-auto max-h-60 whitespace-pre-wrap selectable">
          {JSON.stringify(suspension.suspendPayload, null, 2)}
        </pre>
      )}
      {showReject ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            rows={2}
            placeholder="What should change?"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                const trimmed = feedback.trim()
                onResume({
                  action: 'rejected',
                  ...(isPlan ? planResumeRefs(suspension) : {}),
                  ...(trimmed ? { feedback: trimmed } : {})
                })
              }}
            >
              Request changes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : showRaw ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            rows={3}
            placeholder='Raw resume JSON, e.g. {"approved": true}'
            value={rawJson}
            onChange={(e) => {
              setRawJson(e.target.value)
              setJsonError(null)
            }}
            className="font-mono text-[11px]"
          />
          {jsonError && (
            <div className="text-xs text-destructive selectable">Invalid JSON: {jsonError}</div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                try {
                  onResume(JSON.parse(rawJson))
                } catch (err) {
                  setJsonError(err instanceof Error ? err.message : String(err))
                }
              }}
            >
              Send
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowRaw(false)
                setJsonError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Tip
            content={
              isPlan
                ? 'Accept this plan — the agent switches to build mode and starts implementing it'
                : 'Approve and let the agent continue'
            }
          >
            <Button
              size="sm"
              onClick={() =>
                onResume({
                  action: 'approved',
                  ...(isPlan ? planResumeRefs(suspension) : {})
                })
              }
            >
              {isPlan ? 'Approve plan & build' : 'Approve'}
            </Button>
          </Tip>
          <Tip content="Reject the plan and tell the agent what to revise">
            <Button size="sm" variant="outline" onClick={() => setShowReject(true)}>
              Request changes…
            </Button>
          </Tip>
          <Tip content="Advanced: reply with hand-written resume JSON instead of the buttons">
            <Button size="sm" variant="ghost" onClick={() => setShowRaw(true)}>
              Raw response…
            </Button>
          </Tip>
        </div>
      )}
      {suspension.resumeSchema && (
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer">Expected response schema</summary>
          <pre className="mt-1 overflow-auto max-h-32">{suspension.resumeSchema}</pre>
        </details>
      )}
    </div>
  )
}

/**
 * Read-only history view of a resolved submit_plan tool call. Kept compact —
 * the full plan lives in the plan file, not re-rendered here.
 */
export function PlanApprovalAnswered({ part }: { part: ToolCallPart }): React.JSX.Element {
  const result = (part.result ?? {}) as {
    content?: unknown
    submittedPlan?: { title?: string; path?: string }
  }
  const content = typeof result.content === 'string' ? result.content : null
  // The SDK returns `submittedPlan` for rejections too, so the verdict has to
  // come from the result text, not from that field's presence.
  const rejected = content?.startsWith('Plan was not approved') === true
  const approved =
    !rejected && (content?.startsWith('Plan approved') === true || result.submittedPlan != null)
  const title = result.submittedPlan?.title
  // Older transcripts embedded the user's feedback inside the rejection text.
  const legacyFeedback = rejected
    ? content?.match(/User feedback: ([\s\S]*?)\n\nPlease revise/)?.[1]
    : undefined

  return (
    <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <ClipboardList size={14} className="text-blue-400" />
        Plan review
      </div>
      {approved ? (
        <div className="flex items-center gap-1.5 text-xs text-blue-400 selectable">
          <Check size={13} />
          Plan approved{title ? ` — ${title}` : ''}
        </div>
      ) : rejected ? (
        <>
          <div className="flex items-center gap-1.5 text-xs text-amber-500 selectable">
            <Undo2 size={13} />
            Changes requested{title ? ` — ${title}` : ''}
          </div>
          {legacyFeedback && (
            <div className="text-xs text-muted-foreground selectable whitespace-pre-wrap">
              {legacyFeedback}
            </div>
          )}
        </>
      ) : content ? (
        <div className="text-xs text-muted-foreground selectable whitespace-pre-wrap">
          {content}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">No answer recorded</div>
      )}
    </div>
  )
}
