import React, { useState } from 'react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'

/**
 * Shared "saved — restart agents to apply" banner for settings.json tabs.
 * Mutations against mastraSettings return { needsRestart }; call markDirty()
 * on success and render `banner` at the bottom of the tab.
 */
export function useRestartBanner(): { markDirty: () => void; banner: React.ReactNode } {
  const [dirty, setDirty] = useState(false)
  const applyRestart = trpc.mastraSettings.applyRestart.useMutation({
    onSuccess: () => setDirty(false)
  })
  const banner = dirty ? (
    <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
      <span className="flex-1 text-[11px]">Saved. Restart agents to apply.</span>
      <Button
        size="sm"
        className="h-6 px-2 text-[11px]"
        disabled={applyRestart.isPending}
        onClick={() => applyRestart.mutate()}
      >
        Restart agents
      </Button>
    </div>
  ) : null
  return { markDirty: () => setDirty(true), banner }
}
