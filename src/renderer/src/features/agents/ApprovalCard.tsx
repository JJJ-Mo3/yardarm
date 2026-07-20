import React, { useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'
import { ToolArgsView, toolTitle } from './ToolArgsView'
import type { PendingApproval } from '../../../../shared/ui-message'

export function ApprovalCard({
  approval,
  onDecide
}: {
  approval: PendingApproval
  onDecide: (
    decision: 'approve' | 'decline',
    opts?: { feedback?: string; alwaysAllowToolName?: string }
  ) => void
}): React.JSX.Element {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <ShieldQuestion size={14} className="text-amber-500 shrink-0" />
        <span className="text-[13px] font-medium shrink-0">{toolTitle(approval.toolName)}?</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground shrink-0">
          {approval.toolName}
        </span>
      </div>
      <ToolArgsView toolName={approval.toolName} args={approval.args} />
      {showFeedback ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            rows={2}
            placeholder="Tell the agent why (optional)…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onDecide('decline', { feedback })}
            >
              Deny with feedback
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowFeedback(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Tip content="Run this tool call one time — you'll be asked again next time">
            <Button size="sm" onClick={() => onDecide('approve')}>
              Allow once
            </Button>
          </Tip>
          <Tip
            content={`Run it now and auto-approve every future ${approval.toolName} call in this project`}
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onDecide('approve', { alwaysAllowToolName: approval.toolName })}
            >
              Always allow {approval.toolName}
            </Button>
          </Tip>
          <Tip content="Block this tool call — the agent will continue without it">
            <Button size="sm" variant="outline" onClick={() => onDecide('decline')}>
              Deny
            </Button>
          </Tip>
          <Tip content="Block this tool call and tell the agent why, so it can adjust">
            <Button size="sm" variant="ghost" onClick={() => setShowFeedback(true)}>
              Deny with feedback…
            </Button>
          </Tip>
        </div>
      )}
    </div>
  )
}
