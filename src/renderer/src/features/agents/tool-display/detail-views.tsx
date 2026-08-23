/**
 * Expanded bodies for the compact tool rows: what a row shows when clicked
 * open. Known tools get purpose-built layouts (terminal I/O for commands,
 * inline diffs for edits); everything else falls back to the labeled
 * Arguments/Output sections so no tool loses information. Building blocks
 * (CodeBlock, ArgsDiff, PathRow, ...) are shared with ToolArgsView, which
 * the approval cards still use.
 */
import React from 'react'
import { cn } from '../../../lib/utils'
import type { ToolCallPart } from '../../../../../shared/ui-message'
import {
  ArgsDiff,
  asRecord,
  CodeBlock,
  MetaRow,
  PathRow,
  RawArgsDisclosure,
  ToolArgsView
} from '../ToolArgsView'

function resultText(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

/** Preview text when the clamp replaced oversized args with a stub. */
function truncatedArgsPreview(args: unknown): string | null {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>
    if (obj.__truncated === true && typeof obj.preview === 'string') return obj.preview
  }
  return null
}

/** Accumulated output / final result, tail-capped like the old card. */
export function OutputBlock({ part }: { part: ToolCallPart }): React.JSX.Element | null {
  const output = part.outputText || resultText(part.result)
  if (!output) return null
  return (
    <pre
      className={cn(
        'text-[11px] font-mono bg-muted rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap',
        part.status === 'error' && 'text-destructive'
      )}
    >
      {output.length > 20_000 ? output.slice(-20_000) : output}
    </pre>
  )
}

function TruncatedArgsNote({ preview }: { preview: string }): React.JSX.Element {
  return (
    <div className="space-y-1">
      <CodeBlock text={preview} />
      <div className="text-[10px] text-muted-foreground">(arguments truncated)</div>
    </div>
  )
}

/** execute_command: reads as terminal I/O — command, meta, then output. */
export function CommandDetails({ part }: { part: ToolCallPart }): React.JSX.Element {
  const args = asRecord(part.args)
  const command = typeof args?.command === 'string' ? args.command : null
  const meta: string[] = []
  if (args) {
    if (typeof args.cwd === 'string' && args.cwd) meta.push(`cwd: ${args.cwd}`)
    if (typeof args.timeout === 'number') {
      meta.push(
        args.timeout >= 1000 && args.timeout % 1000 === 0
          ? `timeout: ${args.timeout / 1000}s`
          : `timeout: ${args.timeout} ms`
      )
    }
    if (args.background === true) meta.push('background')
    if (typeof args.tail === 'number') meta.push(`tail: ${args.tail}`)
  }
  return (
    <div className="space-y-1.5">
      {command !== null ? <CodeBlock text={command} className="text-xs" /> : null}
      <MetaRow items={meta} />
      <OutputBlock part={part} />
      {command === null && <RawArgsDisclosure args={part.args} />}
    </div>
  )
}

/** string_replace_lsp: the proposed edit as an inline diff. */
export function EditDetails({ part }: { part: ToolCallPart }): React.JSX.Element {
  const args = asRecord(part.args)
  if (
    args &&
    typeof args.path === 'string' &&
    typeof args.old_string === 'string' &&
    typeof args.new_string === 'string'
  ) {
    return (
      <div className="space-y-1.5">
        <PathRow path={args.path} badges={args.replace_all === true ? ['replace all'] : []} />
        <ArgsDiff path={args.path} oldContent={args.old_string} newContent={args.new_string} />
        <OutputBlock part={part} />
        <RawArgsDisclosure args={part.args} />
      </div>
    )
  }
  return <GenericDetails part={part} />
}

/** write_file: the new content as an all-additions diff. */
export function WriteDetails({ part }: { part: ToolCallPart }): React.JSX.Element {
  const args = asRecord(part.args)
  if (args && typeof args.path === 'string' && typeof args.content === 'string') {
    return (
      <div className="space-y-1.5">
        <PathRow path={args.path} badges={args.overwrite === true ? ['overwrite'] : []} />
        <ArgsDiff path={args.path} oldContent="" newContent={args.content} />
        <OutputBlock part={part} />
        <RawArgsDisclosure args={part.args} />
      </div>
    )
  }
  return <GenericDetails part={part} />
}

/** Read-style tools: a compact args line, then the output. */
export function OutputOnlyDetails({ part }: { part: ToolCallPart }): React.JSX.Element {
  const preview = truncatedArgsPreview(part.args)
  if (preview !== null) {
    return (
      <div className="space-y-1.5">
        <TruncatedArgsNote preview={preview} />
        <OutputBlock part={part} />
      </div>
    )
  }
  const args = asRecord(part.args)
  const path =
    typeof args?.path === 'string'
      ? args.path
      : typeof args?.file_path === 'string'
        ? args.file_path
        : null
  const meta: string[] = []
  if (args) {
    for (const [key, value] of Object.entries(args)) {
      if (key === 'path' || key === 'file_path') continue
      if (typeof value === 'string' && value && value.length <= 120) meta.push(`${key}: ${value}`)
      else if (typeof value === 'number') meta.push(`${key}: ${value}`)
      else if (value === true) meta.push(key)
    }
  }
  return (
    <div className="space-y-1.5">
      {path !== null && <PathRow path={path} />}
      <MetaRow items={meta} />
      <OutputBlock part={part} />
      <RawArgsDisclosure args={part.args} />
    </div>
  )
}

/** Fallback: the old card's labeled Arguments/Output sections. */
export function GenericDetails({ part }: { part: ToolCallPart }): React.JSX.Element {
  const output = part.outputText || resultText(part.result)
  return (
    <div className="space-y-2">
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
          <OutputBlock part={part} />
        </div>
      )}
    </div>
  )
}
