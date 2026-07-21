/**
 * App-wide amber banner shown once an update has been installed and is
 * waiting for a relaunch (updates.status → 'ready-to-restart'). Mounted once
 * in App.tsx above the main content; dismissable per window session.
 */
import React, { useState } from 'react'
import { X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'

export function UpdateRestartBanner(): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false)
  const status = trpc.updates.status.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: false
  })
  const restart = trpc.updates.restart.useMutation()

  const s = status.data
  if (dismissed || s?.phase !== 'ready-to-restart') return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5">
      <span className="flex-1 text-[11px]">
        Yardarm v{s.latestVersion} is installed. Restart to finish updating.
      </span>
      <Tip content="Quit and relaunch Yardarm as the new version">
        <Button
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={restart.isPending}
          onClick={() => restart.mutate()}
        >
          Restart
        </Button>
      </Tip>
      <Tip content="Hide this banner — the update still applies on the next launch">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => setDismissed(true)}
        >
          <X size={12} />
        </Button>
      </Tip>
    </div>
  )
}
