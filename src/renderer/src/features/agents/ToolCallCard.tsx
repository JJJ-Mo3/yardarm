import React, { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  PauseCircle,
  ShieldQuestion,
  Wrench
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'
import { summarizeArgs, ToolArgsView } from './ToolArgsView'
import type { ToolCallPart } from '../../../../shared/ui-message'

function resultText(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

function StatusIcon({ status }: { status: ToolCallPart['status'] }): React.JSX.Element {
  switch (status) {
    case 'success':
      return <Check size={13} className="text-green-500" />
    case 'error':
      return <AlertTriangle size={13} className="text-destructive" />
    case 'awaiting-approval':
      return <ShieldQuestion size={13} className="text-amber-500" />
    case 'suspended':
      return <PauseCircle size={13} className="text-amber-500" />
    default:
      return <Loader2 size={13} className="animate-spin text-muted-foreground" />
  }
}

export function ToolCallCard({ part }: { part: ToolCallPart }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = summarizeArgs(part.args)
  const output = part.outputText || resultText(part.result)

  return (
    <div className="rounded-md border border-border bg-card my-1 overflow-hidden">
      <Tip
        content={
          open ? 'Hide the arguments and output' : "Show this tool call's arguments and output"
        }
      >
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent cursor-pointer"
        >
          {open ? (
            <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-muted-foreground shrink-0" />
          )}
          <Wrench size={12} className="text-muted-foreground shrink-0" />
          <span className="font-medium text-xs shrink-0">{part.toolName}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground flex-1">
            {summary}
          </span>
          <StatusIcon status={part.status} />
        </button>
      </Tip>
      {open && (
        <div className="border-t border-border px-2.5 py-2 space-y-2 selectable">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Arguments
            </div>
            <ToolArgsView toolName={part.toolName} args={part.args} />
          </div>
          {output && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Output
              </div>
              <pre
                className={cn(
                  'text-[11px] font-mono bg-muted rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap',
                  part.status === 'error' && 'text-destructive'
                )}
              >
                {output.length > 20_000 ? output.slice(-20_000) : output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
