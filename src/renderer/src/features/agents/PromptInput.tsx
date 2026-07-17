import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'

interface SlashCommand {
  name: string
  description: string
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'plan', description: 'Switch to plan mode' },
  { name: 'build', description: 'Switch to build mode' },
  { name: 'fast', description: 'Switch to fast mode' }
]

export function PromptInput({
  disabled,
  running,
  projectRoot,
  onSend,
  onAbort,
  onSlashCommand
}: {
  disabled: boolean
  running: boolean
  projectRoot: string | null
  onSend: (content: string) => void
  onAbort: () => void
  onSlashCommand: (command: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const mentionResults = trpc.files.search.useQuery(
    { root: projectRoot ?? '', query: mentionQuery ?? '', limit: 8 },
    { enabled: mentionQuery !== null && !!projectRoot }
  )
  const files = mentionQuery !== null ? (mentionResults.data ?? []) : []

  const slashActive = value.startsWith('/') && !value.includes(' ') && value.length > 0
  const slashMatches = slashActive
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(value.slice(1)))
    : []

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery])

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

  function submit(): void {
    const content = value.trim()
    if (!content) return
    if (content.startsWith('/')) {
      const cmd = content.slice(1).split(/\s+/)[0]
      if (SLASH_COMMANDS.some((c) => c.name === cmd)) {
        onSlashCommand(cmd)
        setValue('')
        return
      }
    }
    onSend(content)
    setValue('')
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
        <div className="absolute bottom-full left-3 right-3 mb-1 rounded-md border border-border bg-background shadow-lg overflow-hidden z-10">
          {slashMatches.map((c) => (
            <button
              key={c.name}
              onClick={() => {
                onSlashCommand(c.name)
                setValue('')
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent cursor-pointer"
            >
              <span className="font-mono text-[12px]">/{c.name}</span>
              <span className="text-[11px] text-muted-foreground">{c.description}</span>
            </button>
          ))}
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
