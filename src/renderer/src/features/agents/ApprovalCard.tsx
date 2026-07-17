import React, { useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
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
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <ShieldQuestion size={14} className="text-amber-500" />
        Approve <span className="font-mono">{approval.toolName}</span>?
      </div>
      <pre className="text-[11px] font-mono bg-muted rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap selectable">
        {typeof approval.args === 'string'
          ? approval.args
          : JSON.stringify(approval.args, null, 2)}
      </pre>
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
            <Button size="sm" variant="destructive" onClick={() => onDecide('decline', { feedback })}>
              Deny with feedback
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowFeedback(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecide('approve')}>
            Allow once
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onDecide('approve', { alwaysAllowToolName: approval.toolName })}
          >
            Always allow {approval.toolName}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide('decline')}>
            Deny
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowFeedback(true)}>
            Deny with feedback…
          </Button>
        </div>
      )}
    </div>
  )
}
