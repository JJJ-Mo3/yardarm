import React, { useEffect, useRef, useState } from 'react'
import { useSetAtom } from 'jotai'
import { CheckCircle2, Download, ExternalLink, RefreshCw, Wand2, XCircle } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { onboardingForceOpenAtom, settingsOpenAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'

// Strip CSI/OSC escape sequences and carriage returns from pty output.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\r/g

function updateStatusText(s: { phase: string; latestVersion?: string; progress?: number }): string {
  switch (s.phase) {
    case 'checking':
      return 'Checking…'
    case 'up-to-date':
      return 'Up to date'
    case 'update-available':
      return `Update v${s.latestVersion} available`
    case 'downloading':
      return s.progress !== undefined
        ? `Downloading… ${Math.round(s.progress * 100)}%`
        : 'Downloading…'
    case 'installing':
      return 'Installing…'
    case 'ready-to-restart':
      return 'Restart to finish updating'
    case 'error':
      return 'Update failed'
    default:
      return 'Not checked yet'
  }
}

/** "Updates" section: check/install from GitHub Releases + auto-update toggle. */
function UpdatesSection(): React.JSX.Element {
  const utils = trpc.useUtils()
  const status = trpc.updates.status.useQuery(undefined, {
    refetchInterval: (query) => {
      const phase = query.state.data?.phase
      return phase === 'checking' || phase === 'downloading' || phase === 'installing' ? 750 : false
    }
  })
  const invalidate = (): void => void utils.updates.status.invalidate()
  const check = trpc.updates.check.useMutation({ onSuccess: invalidate, onError: invalidate })
  const install = trpc.updates.install.useMutation({ onSuccess: invalidate, onError: invalidate })
  const openRelease = trpc.updates.openRelease.useMutation()
  const restart = trpc.updates.restart.useMutation()
  const setAuto = trpc.updates.setAutoUpdate.useMutation({ onSuccess: invalidate })

  const s = status.data
  const busy =
    s?.phase === 'checking' ||
    s?.phase === 'downloading' ||
    s?.phase === 'installing' ||
    check.isPending ||
    install.isPending

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="text-xs font-medium">Updates</div>
      <Row label="Status" value={s ? updateStatusText(s) : '…'} />
      {s?.phase === 'downloading' && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.round((s.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}
      {(s?.phase === 'checking' || s?.phase === 'installing') && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
        </div>
      )}
      {s?.phase === 'error' && s.error && (
        <div className="text-xs text-destructive selectable">{s.error}</div>
      )}
      {s?.phase === 'ready-to-restart' ? (
        <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <span className="flex-1 text-[11px]">
            Update v{s.latestVersion} installed. Restart to finish.
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
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Tip content="Check the Yardarm GitHub releases for a newer version">
            <span className="inline-flex">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => check.mutate()}>
                <RefreshCw size={12} />
                Check for updates
              </Button>
            </span>
          </Tip>
          {s?.phase === 'update-available' && s.canInstall && (
            <Tip content="Download and install the update, then ask to restart">
              <span className="inline-flex">
                <Button size="sm" disabled={busy} onClick={() => install.mutate()}>
                  <Download size={12} />
                  Install v{s.latestVersion}
                </Button>
              </span>
            </Tip>
          )}
          {s?.phase === 'update-available' && !s.canInstall && (
            <Tip content="This build can't update itself — opens the release page to download manually">
              <span className="inline-flex">
                <Button size="sm" variant="outline" onClick={() => openRelease.mutate()}>
                  <ExternalLink size={12} />
                  View release
                </Button>
              </span>
            </Tip>
          )}
        </div>
      )}
      <Tip content="Check on launch and every 4 hours, install updates automatically, and ask to restart when ready">
        <label className="flex w-fit items-center gap-2 text-xs">
          <Switch
            checked={s?.autoUpdate ?? true}
            disabled={setAuto.isPending}
            onCheckedChange={(v) => setAuto.mutate({ enabled: v })}
          />
          Automatically update
        </label>
      </Tip>
    </div>
  )
}

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
  const mcLatest = trpc.system.mastracodeLatest.useQuery(undefined, { staleTime: 60 * 60_000 })
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
                {mcLatest.data?.isNewer && mcLatest.data.latest && (
                  <span className="text-muted-foreground">
                    · v{mcLatest.data.latest} available — ships with the next app update
                  </span>
                )}
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

      <UpdatesSection />

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
                ? cli.data.version
                  ? `installed (${cli.data.version})`
                  : 'installed'
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
