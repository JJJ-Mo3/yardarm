import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import type { SlashCommandEntry } from './slash-commands'

const KIND_LABEL: Record<SlashCommandEntry['kind'], string | null> = {
  builtin: null,
  custom: 'custom',
  'cli-only': 'CLI'
}

export interface ComposerAttachment {
  data: string
  mediaType: string
  filename?: string
}

/** Read an image file into a base64 attachment (no data: prefix). */
function fileToAttachment(file: File): Promise<ComposerAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      const base64 = url.slice(url.indexOf(',') + 1)
      resolve({ data: base64, mediaType: file.type, filename: file.name || undefined })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function PromptInput({
  disabled,
  running,
  projectRoot,
  commands,
  onSend,
  onAbort,
  onSlashCommand,
  prefill,
  onPrefillConsumed
}: {
  disabled: boolean
  running: boolean
  projectRoot: string | null
  commands: SlashCommandEntry[]
  onSend: (content: string, files?: ComposerAttachment[]) => void
  onAbort: () => void
  /** Handle a slash command; return a string to show as an inline hint. */
  onSlashCommand: (entry: SlashCommandEntry, args: string) => string | void
  /** One-shot text to place in the input (e.g. a rolled-back message). */
  prefill?: string | null
  onPrefillConsumed?: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
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
    if (typeof prefill === 'string') {
      setValue(prefill)
      requestAnimationFrame(() => textareaRef.current?.focus())
      onPrefillConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // Grow the textarea with its content (including wrapped long lines, which a
  // newline count alone misses) up to a cap, then scroll internally.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])

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

  /** Add pasted/dropped image files as attachments (disabled mid-run). */
  async function addFiles(files: File[]): Promise<void> {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    if (running) {
      setHint('Attachments are unavailable while the agent is running — wait for the run to finish.')
      return
    }
    const converted = await Promise.all(images.map(fileToAttachment))
    setAttachments((prev) => [...prev, ...converted])
  }

  function submit(): void {
    const content = value.trim()
    if (!content && attachments.length === 0) return
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
    if (running && attachments.length > 0) {
      setHint('Attachments are unavailable while the agent is running — remove them or wait.')
      return
    }
    onSend(content || 'See the attached file(s).', attachments.length ? attachments : undefined)
    setValue('')
    setAttachments([])
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
    <div
      className="relative border-t border-border p-3"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault()
          void addFiles(Array.from(e.dataTransfer.files))
        }
      }}
    >
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
      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <div
              key={i}
              className="group relative h-12 w-12 overflow-hidden rounded border border-border"
              title={a.filename ?? a.mediaType}
            >
              <img
                src={`data:${a.mediaType};base64,${a.data}`}
                alt={a.filename ?? 'attachment'}
                className="h-full w-full object-cover"
              />
              <button
                title="Remove attachment"
                className="absolute right-0 top-0 hidden rounded-bl bg-background/80 p-0.5 group-hover:block cursor-pointer"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={3}
          value={value}
          disabled={disabled}
          placeholder="Message the agent… (@ to mention files, / for commands, paste images)"
          onChange={(e) => {
            setValue(e.target.value)
            setHint(null)
            updateMention(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.some((f) => f.type.startsWith('image/'))) {
              e.preventDefault()
              void addFiles(files)
            }
          }}
          className="max-h-[240px] min-h-[72px] flex-1 resize-none overflow-y-auto rounded-md border border-border bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        {running && !value.trim() ? (
          <Button size="icon" variant="destructive" title="Stop" onClick={onAbort}>
            <Square size={13} />
          </Button>
        ) : (
          <Button
            size="icon"
            title={running ? 'Queue message (runs after the current turn)' : 'Send'}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            onClick={submit}
          >
            <ArrowUp size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}
