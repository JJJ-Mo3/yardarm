/**
 * Renders a request_access (sandbox access) tool suspension. The tool's
 * resumeSchema is `string | string[]` and it checks whether the answer
 * starts with "y" — the TUI resumes with "Yes"/"No", so we do too.
 */
import React from 'react'
import { ShieldQuestion } from 'lucide-react'
import { Button } from '../../components/ui/button'
import type { PendingSuspension, ToolCallPart } from '../../../../shared/ui-message'

interface SandboxAccessPayload {
  path?: string
  reason?: string
}

export function SandboxAccessCard({
  suspension,
  onResume
}: {
  suspension: PendingSuspension
  onResume: (resumeData: string) => void
}): React.JSX.Element {
  const payload = (suspension.suspendPayload ?? suspension.args ?? {}) as SandboxAccessPayload

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <ShieldQuestion size={14} className="text-amber-500" />
        Sandbox access request
      </div>
      <div className="text-xs selectable">
        The agent wants access to{' '}
        <span className="font-mono text-[11px] bg-muted rounded px-1 py-0.5">
          {payload.path ?? '(unknown path)'}
        </span>
      </div>
      {payload.reason && (
        <div className="text-xs text-muted-foreground selectable">Reason: {payload.reason}</div>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onResume('Yes')}>
          Allow
        </Button>
        <Button size="sm" variant="outline" onClick={() => onResume('No')}>
          Deny
        </Button>
      </div>
    </div>
  )
}

/** Read-only history view of a resolved request_access tool call. */
export function SandboxAccessAnswered({ part }: { part: ToolCallPart }): React.JSX.Element {
  const args = (part.args ?? {}) as SandboxAccessPayload
  const result = part.result as { content?: unknown } | undefined
  const line = typeof result?.content === 'string' ? result.content : null

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <ShieldQuestion size={14} className="text-amber-500" />
        Sandbox access request
      </div>
      {args.path && (
        <div className="text-xs selectable">
          <span className="font-mono text-[11px] bg-muted rounded px-1 py-0.5">{args.path}</span>
        </div>
      )}
      {line ? (
        <div className="text-xs text-muted-foreground selectable">{line}</div>
      ) : (
        <div className="text-xs text-muted-foreground italic">No answer recorded</div>
      )}
    </div>
  )
}
