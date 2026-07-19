import React, { useEffect, useRef, useState } from 'react'
import { useSetAtom } from 'jotai'
import { CheckCircle2, Wand2, XCircle } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { onboardingForceOpenAtom, settingsOpenAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'

// Strip CSI/OSC escape sequences and carriage returns from pty output.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\r/g

function Row({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="selectable">{value}</span>
    </div>
  )
}

export function AboutTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const preflight = trpc.system.preflight.useQuery(undefined, { staleTime: 60_000 })
  const cli = trpc.system.detectCli.useQuery()
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setForceOnboarding = useSetAtom(onboardingForceOpenAtom)

  const [termId, setTermId] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const install = trpc.system.installCli.useMutation({
    onSuccess: (res) => {
      setLog('')
      setExitCode(null)
      setTermId(res.terminalId)
    }
  })

  trpc.terminal.stream.useSubscription(termId ? { id: termId } : (undefined as never), {
    enabled: termId !== null,
    onData: (ev) => {
      if (ev.type === 'data') {
        setLog((l) => (l + ev.data.replace(ANSI_RE, '')).slice(-20_000))
      } else {
        setTermId(null)
        setExitCode(ev.code)
        utils.system.detectCli.invalidate()
      }
    }
  })

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  const p = preflight.data
  const installing = install.isPending || termId !== null

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Row label="App version" value={p?.appVersion ?? '…'} />
        <Row
          label="Mastra Code (bundled)"
          value={
            p === undefined ? (
              '…'
            ) : (
              <span className="flex items-center gap-1.5">
                {p.mastracodeVersion ?? 'not found'}
                {p.ok ? (
                  <CheckCircle2 size={12} className="text-green-500" />
                ) : (
                  <XCircle size={12} className="text-destructive" />
                )}
                <span className="text-muted-foreground">
                  {p.ok ? 'runtime OK' : 'runtime failed to boot'}
                </span>
              </span>
            )
          }
        />
        <Row label="Node (embedded)" value={p?.nodeVersion ?? '…'} />
        {p && !p.ok && p.error && (
          <pre className="selectable max-h-32 overflow-auto rounded border border-border bg-muted/30 p-2 text-[11px] whitespace-pre-wrap">
            {p.error}
          </pre>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-xs font-medium">Setup</div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSettingsOpen(false)
            setForceOnboarding(true)
          }}
        >
          <Wand2 size={12} />
          Run setup again
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-xs font-medium">Global CLI</div>
        <div className="text-[11px] text-muted-foreground">
          The app runs its bundled runtime — a global <code>mastracode</code> CLI is optional, for
          use in your own terminal. It shares config in <code>~/.mastracode/</code>.
        </div>
        <Row
          label="mastracode on PATH"
          value={
            cli.isLoading
              ? 'checking…'
              : cli.data?.found
                ? `installed (${cli.data.version})`
                : 'not installed'
          }
        />
        {!cli.data?.found && !cli.isLoading && (
          <Button size="sm" disabled={installing} onClick={() => install.mutate()}>
            {installing ? 'Installing…' : 'Install CLI (npm i -g mastracode)'}
          </Button>
        )}
        {install.error && (
          <div className="text-xs text-destructive selectable">{install.error.message}</div>
        )}
        {(log || installing) && (
          <pre
            ref={logRef}
            className="selectable max-h-48 overflow-auto rounded border border-border bg-muted/30 p-2 font-mono text-[10px] whitespace-pre-wrap"
          >
            {log || 'Starting install…'}
          </pre>
        )}
        {exitCode !== null && (
          <div className="text-xs">
            {exitCode === 0 ? (
              <span className="text-green-500">Install finished.</span>
            ) : (
              <span className="text-destructive">Install exited with code {exitCode}.</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
