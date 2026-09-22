/**
 * Header popover for opening the chat's working folder (worktree or project
 * root) in an installed external app — Finder reveal, editors and terminals
 * via the external router. Hidden when there is no path or no detected apps
 * (i.e. off macOS).
 */
import React, { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Tip } from '../../components/ui/tooltip'
import { APP_META } from '../../../../shared/external-apps'

export function OpenLocallyMenu({ path }: { path: string | null }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const apps = trpc.external.detectApps.useQuery(undefined, { staleTime: Infinity })
  const openIn = trpc.external.openPathInApp.useMutation({
    onSuccess: () => {
      setError(null)
      setOpen(false)
    },
    onError: (e) => setError(e.message)
  })

  if (!path || !apps.data || apps.data.length === 0) return null
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setError(null)
      }}
    >
      <Tip content="Open this chat's folder in Finder, an editor or a terminal" side="bottom">
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer">
            <FolderOpen size={11} />
            open
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-52 p-1.5">
        <div className="truncate px-1.5 pb-1 pt-0.5 text-[10px] text-muted-foreground" title={path}>
          {path}
        </div>
        {apps.data.map((app) => (
          <Tip
            key={app}
            content={
              app === 'finder'
                ? 'Reveal the folder in Finder'
                : `Open the folder in ${APP_META[app].label}`
            }
            side="left"
          >
            <span className="flex">
              <button
                className="w-full rounded px-1.5 py-1 text-left text-[11px] hover:bg-secondary cursor-pointer disabled:opacity-50"
                disabled={openIn.isPending}
                onClick={() => openIn.mutate({ app, path })}
              >
                {app === 'finder' ? 'Reveal in Finder' : `Open in ${APP_META[app].label}`}
              </button>
            </span>
          </Tip>
        ))}
        {error && <div className="px-1.5 pt-1 text-[10px] text-red-500">{error}</div>}
      </PopoverContent>
    </Popover>
  )
}
