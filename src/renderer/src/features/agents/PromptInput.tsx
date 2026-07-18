import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import type { SlashCommandEntry } from './slash-commands'

const KIND_LABEL: Record<SlashCommandEntry['kind'], string | null> = {
  builtin: null,
  custom: 'custom',
  'cli-only': 'CLI'
}

export function PromptInput({
  disabled,
  running,
  projectRoot,
  commands,
  onSend,
  onAbort,
  onSlashCommand
}: {
  disabled: boolean
  running: boolean
  projectRoot: string | null
  commands: SlashCommandEntry[]
  onSend: (content: string) => void
  onAbort: () => void
  /** Handle a slash command; return a string to show as an inline hint. */
  onSlashCommand: (entry: SlashCommandEntry, args: string) => string | void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [slashIndex, setSlashIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const mentionResults = trpc.files.search.useQuery(
    { root: projectRoot ?? '', query: mentionQuery ?? '', limit: 8 },
    { enabled: mentionQuery !== null && !!projectRoot }
  )
  const files = mentionQuery !== null ? (mentionResults.data ?? []) : []

  const slashActive = value.startsWith('/') && !/\s/.test(value)
  const slashQuery = slashActive ? value.slice(1) : ''
  const slashMatches = slashActive
    ? commands.filter((c) => c.name.startsWith(slashQuery)).slice(0, 12)
    : []

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery])

  useEffect(() => {
    setSlashIndex(0)
  }, [slashQuery])

  function updateMention(text: string, caret: number): void {
    const before = text.slice(0, caret)
    const m = before.match(/(?:^|\s)@([\w./-]*)$/)
    setMentionQuery(m ? m[1] : null)
  }

  function insertMention(path: string): void {
    const el = textareaRef.current
    if (!el) return
    const caret = el.selectionStart
    const before = value.slice(0, caret).replace(/@[\w./-]*$/, `@${path} `)
    setValue(before + value.slice(caret))
    setMentionQuery(null)
    requestAnimationFrame(() => el.focus())
  }

  function runSlash(entry: SlashCommandEntry, args: string): void {
    if (entry.kind === 'cli-only') {
      setHint(
        `/${entry.name} isn't wired into the app yet — run it in the mastracode CLI. See /help.`
      )
      return
    }
    const result = onSlashCommand(entry, args)
    setHint(typeof result === 'string' ? result : null)
    setValue('')
  }

  /** Complete to `/name ` when the command takes args, else run it. */
  function pickSlash(entry: SlashCommandEntry): void {
    if (entry.args) {
      setValue(`/${entry.name} `)
      requestAnimationFrame(() => textareaRef.current?.focus())
    } else {
      runSlash(entry, '')
    }
  }

  function submit(): void {
    const content = value.trim()
    if (!content) return
    if (content.startsWith('/')) {
      const m = content.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
      const name = m?.[1] ?? ''
      const entry = commands.find((c) => c.name === name)
      if (!entry) {
        setHint(`Unknown command: /${name} — type /help for all commands.`)
        return
      }
      runSlash(entry, m?.[2]?.trim() ?? '')
      return
    }
    onSend(content)
    setValue('')
    setHint(null)
    setMentionQuery(null)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionQuery !== null && files.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % files.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + files.length) % files.length)
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        insertMention(files[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
    if (slashMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % slashMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        setValue(`/${slashMatches[slashIndex].name} `)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        pickSlash(slashMatches[slashIndex])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="relative border-t border-border p-3">
      {mentionQuery !== null && files.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 rounded-md border border-border bg-background shadow-lg overflow-hidden z-10">
          {files.map((f, i) => (
            <button
              key={f}
              onClick={() => insertMention(f)}
              className={cn(
                'block w-full truncate px-2.5 py-1.5 text-left font-mono text-[11px] cursor-pointer',
                i === mentionIndex ? 'bg-accent' : 'hover:bg-accent'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      {slashMatches.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 max-h-72 overflow-y-auto rounded-md border border-border bg-background shadow-lg z-10">
          {slashMatches.map((c, i) => (
            <button
              key={c.name}
              onClick={() => pickSlash(c)}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer',
                i === slashIndex ? 'bg-accent' : 'hover:bg-accent'
              )}
            >
              <span className="font-mono text-[12px]">
                /{c.name}
                {c.args ? <span className="text-muted-foreground"> {c.args}</span> : null}
              </span>
              <span className="flex-1 truncate text-[11px] text-muted-foreground">
                {c.description}
              </span>
              {KIND_LABEL[c.kind] && (
                <span className="rounded border border-border px-1 text-[9px] uppercase text-muted-foreground">
                  {KIND_LABEL[c.kind]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {hint && (
        <div className="mb-1.5 rounded bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground selectable">
          {hint}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={Math.min(6, Math.max(1, value.split('\n').length))}
          value={value}
          disabled={disabled}
          placeholder="Message the agent… (@ to mention files, / for commands)"
          onChange={(e) => {
            setValue(e.target.value)
            setHint(null)
            updateMention(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={onKeyDown}
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        {running ? (
          <Button size="icon" variant="destructive" title="Stop" onClick={onAbort}>
            <Square size={13} />
          </Button>
        ) : (
          <Button size="icon" title="Send" disabled={disabled || !value.trim()} onClick={submit}>
            <ArrowUp size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}
