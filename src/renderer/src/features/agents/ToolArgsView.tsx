import React, { useMemo } from 'react'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import { generateDiffFile } from '@git-diff-view/file'
import { ChevronRight, FileCode2, Folder, Terminal, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useIsDark } from '../../lib/use-dark'
import { Badge } from '../../components/ui/badge'

/**
 * Human-readable rendering of tool-call arguments, used by the approval
 * prompt and the transcript tool cards. Known tools get a purpose-built
 * body (command block, diff, path row); everything else falls back to the
 * raw JSON. Raw input stays available behind a collapsed disclosure.
 */

/** One-line summary of tool args: the first meaningful string field. */
export function summarizeArgs(args: unknown): string {
  if (args == null) return ''
  if (typeof args === 'string') return args
  if (typeof args !== 'object') return String(args)
  const obj = args as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
    const v = obj[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  try {
    const s = JSON.stringify(args)
    return s.length > 120 ? s.slice(0, 120) + '…' : s
  } catch {
    return ''
  }
}

const HEADLINES: Record<string, string> = {
  execute_command: 'Run command',
  string_replace_lsp: 'Edit file',
  write_file: 'Write file',
  delete_file: 'Delete file',
  mkdir: 'Create folder',
  ast_smart_edit: 'Edit file (AST)',
  kill_process: 'Kill process',
  get_process_output: 'Read process output',
  subagent: 'Run subagent'
}

/** Friendly action title + primary argument for headers. */
export function toolHeadline(
  toolName: string,
  args: unknown
): { title: string; subtitle?: string } {
  const title = HEADLINES[toolName] ?? `Use ${toolName}`
  const subtitle = summarizeArgs(args)
  return subtitle ? { title, subtitle } : { title }
}

/** String → parsed JSON when possible; plain objects pass through. */
function asRecord(args: unknown): Record<string, unknown> | null {
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function rawText(args: unknown): string {
  if (typeof args === 'string') return args
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function CodeBlock({ text, className }: { text: string; className?: string }): React.JSX.Element {
  return (
    <pre
      className={cn(
        'text-[11px] font-mono bg-muted rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap selectable',
        className
      )}
    >
      {text}
    </pre>
  )
}

function PathRow({
  path,
  icon,
  badges,
  destructive
}: {
  path: string
  icon?: React.ReactNode
  badges?: string[]
  destructive?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className={cn('shrink-0', destructive ? 'text-destructive' : 'text-muted-foreground')}>
        {icon ?? <FileCode2 size={13} />}
      </span>
      <span
        className={cn(
          'font-mono text-[11px] truncate selectable',
          destructive && 'text-destructive'
        )}
        title={path}
      >
        {path}
      </span>
      {badges?.map((b) => (
        <Badge key={b} className="shrink-0">
          {b}
        </Badge>
      ))}
    </div>
  )
}

function MetaRow({ items }: { items: string[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
      {items.map((it) => (
        <span key={it}>{it}</span>
      ))}
    </div>
  )
}

function Disclosure({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight size={11} className="transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  )
}

function RawArgsDisclosure({ args }: { args: unknown }): React.JSX.Element {
  return (
    <Disclosure label="Raw input">
      <CodeBlock text={rawText(args)} />
    </Disclosure>
  )
}

const MAX_DIFF_CHARS = 50_000

function capContent(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DIFF_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_DIFF_CHARS) + '\n… [truncated]', truncated: true }
}

function ArgsDiff({
  path,
  oldContent,
  newContent
}: {
  path: string
  oldContent: string
  newContent: string
}): React.JSX.Element {
  const dark = useIsDark()
  const oldCapped = capContent(oldContent)
  const newCapped = capContent(newContent)
  const diffFile = useMemo(() => {
    try {
      // File name is used for syntax-highlight language inference.
      const file = generateDiffFile(path, oldCapped.text, path, newCapped.text, '', '')
      file.initRaw()
      return file
    } catch (err) {
      console.error('args diff generation failed', err)
      return null
    }
  }, [path, oldCapped.text, newCapped.text])

  if (!diffFile) {
    // Pathological content the diff library rejects: labeled plain blocks.
    return (
      <div className="space-y-1.5">
        {oldContent.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Old
            </div>
            <CodeBlock text={oldCapped.text} className="border border-destructive/30" />
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">New</div>
          <CodeBlock text={newCapped.text} className="border border-green-500/30" />
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="max-h-64 overflow-auto rounded border border-border text-xs selectable">
        <DiffView
          diffFile={diffFile}
          diffViewMode={DiffModeEnum.Unified}
          diffViewFontSize={11}
          diffViewTheme={dark ? 'dark' : 'light'}
          diffViewHighlight
        />
      </div>
      {(oldCapped.truncated || newCapped.truncated) && (
        <div className="text-[10px] text-muted-foreground">
          Showing the first {Math.round(MAX_DIFF_CHARS / 1000)} KB — open Raw input for the rest.
        </div>
      )}
    </div>
  )
}

function LabeledValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
        {label}
      </span>
      <span className="font-mono text-[11px] truncate selectable" title={value}>
        {value}
      </span>
    </div>
  )
}

/** Default body: one-line summary + the JSON tucked behind "Details". */
function DefaultArgs({ args }: { args: unknown }): React.JSX.Element {
  const summary = summarizeArgs(args)
  return (
    <div className="space-y-1.5">
      {summary && (
        <div className="font-mono text-[11px] text-muted-foreground truncate selectable">
          {summary}
        </div>
      )}
      <Disclosure label="Details">
        <CodeBlock text={rawText(args)} />
      </Disclosure>
    </div>
  )
}

export function ToolArgsView({
  toolName,
  args
}: {
  toolName: string
  args: unknown
}): React.JSX.Element {
  const obj = asRecord(args)

  if (obj) {
    switch (toolName) {
      case 'execute_command': {
        if (typeof obj.command === 'string') {
          const meta: string[] = []
          if (typeof obj.cwd === 'string' && obj.cwd) meta.push(`cwd: ${obj.cwd}`)
          if (typeof obj.timeout === 'number') meta.push(`timeout: ${obj.timeout} ms`)
          if (obj.background === true) meta.push('background')
          if (typeof obj.tail === 'number') meta.push(`tail: ${obj.tail}`)
          return (
            <div className="space-y-1.5">
              <div className="flex items-start gap-1.5">
                <Terminal size={13} className="text-muted-foreground shrink-0 mt-[3px]" />
                <CodeBlock text={obj.command} className="flex-1 text-xs" />
              </div>
              <MetaRow items={meta} />
              <RawArgsDisclosure args={args} />
            </div>
          )
        }
        break
      }
      case 'string_replace_lsp': {
        if (
          typeof obj.path === 'string' &&
          typeof obj.old_string === 'string' &&
          typeof obj.new_string === 'string'
        ) {
          return (
            <div className="space-y-1.5">
              <PathRow path={obj.path} badges={obj.replace_all === true ? ['replace all'] : []} />
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Proposed replacement
              </div>
              <ArgsDiff path={obj.path} oldContent={obj.old_string} newContent={obj.new_string} />
              <RawArgsDisclosure args={args} />
            </div>
          )
        }
        break
      }
      case 'write_file': {
        if (typeof obj.path === 'string' && typeof obj.content === 'string') {
          return (
            <div className="space-y-1.5">
              <PathRow path={obj.path} badges={obj.overwrite === true ? ['overwrite'] : []} />
              <ArgsDiff path={obj.path} oldContent="" newContent={obj.content} />
              <RawArgsDisclosure args={args} />
            </div>
          )
        }
        break
      }
      case 'delete_file': {
        if (typeof obj.path === 'string') {
          return (
            <div className="space-y-1.5">
              <PathRow
                path={obj.path}
                icon={<Trash2 size={13} />}
                destructive
                badges={obj.recursive === true ? ['recursive'] : []}
              />
              <RawArgsDisclosure args={args} />
            </div>
          )
        }
        break
      }
      case 'mkdir': {
        if (typeof obj.path === 'string') {
          return (
            <div className="space-y-1.5">
              <PathRow
                path={obj.path}
                icon={<Folder size={13} />}
                badges={obj.recursive === true ? ['recursive'] : []}
              />
              <RawArgsDisclosure args={args} />
            </div>
          )
        }
        break
      }
      case 'ast_smart_edit': {
        if (typeof obj.path === 'string') {
          return (
            <div className="space-y-1.5">
              <PathRow path={obj.path} />
              {typeof obj.transform === 'string' && (
                <LabeledValue label="Transform" value={obj.transform} />
              )}
              {typeof obj.targetName === 'string' && (
                <LabeledValue
                  label="Target"
                  value={
                    typeof obj.newName === 'string'
                      ? `${obj.targetName} → ${obj.newName}`
                      : obj.targetName
                  }
                />
              )}
              {typeof obj.pattern === 'string' && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Pattern
                  </div>
                  <CodeBlock text={obj.pattern} />
                </div>
              )}
              {typeof obj.replacement === 'string' && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Replacement
                  </div>
                  <CodeBlock text={obj.replacement} />
                </div>
              )}
              {obj.importSpec != null && (
                <LabeledValue label="Import" value={rawText(obj.importSpec)} />
              )}
              <RawArgsDisclosure args={args} />
            </div>
          )
        }
        break
      }
      case 'kill_process':
      case 'get_process_output': {
        if (typeof obj.pid === 'string' || typeof obj.pid === 'number') {
          const meta: string[] = []
          if (typeof obj.tail === 'number') meta.push(`tail: ${obj.tail}`)
          if (obj.wait === true) meta.push('wait')
          return (
            <div className="space-y-1.5">
              <LabeledValue label="PID" value={String(obj.pid)} />
              <MetaRow items={meta} />
              <RawArgsDisclosure args={args} />
            </div>
          )
        }
        break
      }
    }
  }

  // Unknown tool or unexpected arg shape (e.g. an MCP tool reusing a name).
  return <DefaultArgs args={args} />
}
