import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/button'

interface BootErrorScreenProps {
  error?: string
  mastracodeVersion: string | null
  nodeVersion: string
  onRetry: () => void
  retrying: boolean
}

/** Full-window gate shown when the bundled mastracode runtime fails to boot. */
export function BootErrorScreen({
  error,
  mastracodeVersion,
  nodeVersion,
  onRetry,
  retrying
}: BootErrorScreenProps): React.JSX.Element {
  return (
    <div className="titlebar-drag flex h-full flex-col items-center justify-center gap-4 p-8">
      <AlertTriangle size={32} className="text-destructive" strokeWidth={1.5} />
      <div className="text-sm font-medium">Mastra Code runtime failed to start</div>
      <div className="max-w-md text-center text-xs text-muted-foreground">
        Yardarm ships with a bundled Mastra Code runtime
        {mastracodeVersion ? ` (v${mastracodeVersion})` : ''}, but it could not be booted. The app
        cannot run agents until this is resolved.
      </div>
      {error && (
        <pre className="selectable max-h-40 max-w-xl overflow-auto rounded border border-border bg-muted/30 p-3 text-[11px] whitespace-pre-wrap">
          {error}
        </pre>
      )}
      <div className="text-[11px] text-muted-foreground">
        Bundled runtime: {mastracodeVersion ?? 'not found'} · Node {nodeVersion}
      </div>
      <Button size="sm" onClick={onRetry} disabled={retrying}>
        <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
        Retry
      </Button>
    </div>
  )
}
