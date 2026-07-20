import React from 'react'
import { useAtom } from 'jotai'
import { helpOpenAtom } from '../../lib/atoms'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import type { SlashCommandEntry } from './slash-commands'

function CommandGroup({
  title,
  commands,
  note
}: {
  title: string
  commands: SlashCommandEntry[]
  note?: string
}): React.JSX.Element | null {
  if (commands.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-xs font-medium">{title}</div>
      {note && <div className="mb-1.5 text-[11px] text-muted-foreground">{note}</div>}
      <div className="space-y-0.5">
        {commands.map((c) => (
          <div key={c.name} className="flex items-baseline gap-2 text-[12px]">
            <span className="w-44 shrink-0 font-mono">
              /{c.name}
              {c.args ? <span className="text-muted-foreground"> {c.args}</span> : null}
            </span>
            <span className="text-muted-foreground">{c.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function HelpDialog({ commands }: { commands: SlashCommandEntry[] }): React.JSX.Element {
  const [open, setOpen] = useAtom(helpOpenAtom)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Slash commands</DialogTitle>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <CommandGroup title="In-app" commands={commands.filter((c) => c.kind === 'builtin')} />
          <CommandGroup
            title="Custom commands"
            note="Markdown commands from .mastracode/commands/ in this worktree (and ~/.mastracode/commands/)."
            commands={commands.filter((c) => c.kind === 'custom')}
          />
          <CommandGroup
            title="CLI-only"
            note="Available in the mastracode terminal CLI, which shares config with this app."
            commands={commands.filter((c) => c.kind === 'cli-only')}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
