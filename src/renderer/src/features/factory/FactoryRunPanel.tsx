/**
 * Factory Server section — start/stop `npm run dev` in the checkout and use
 * the Factory dashboard in an embedded webview. The dashboard URL is
 * auto-detected from the server pty's scrollback (terminal.detectUrls, same
 * as Preview); the webview uses a persistent session partition so the
 * dashboard sign-in survives app restarts. Toolbar/DevTools follow
 * PreviewView's patterns (main-process DevTools overlay pane).
 */
import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Factory,
  Play,
  RotateCw,
  ScrollText,
  Square,
  Wrench
} from 'lucide-react'
import { isLocalhostHttpUrl, normalizeLocalhostUrl } from '@shared/localhost-url'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import type { WebviewElement } from '../preview/webview'
import { FactoryTerminal } from './FactoryTerminal'

export function FactoryRunPanel({
  dir,
  active,
  serverRunning,
  scaffolded,
  missingRequired
}: {
  dir: string
  active: boolean
  serverRunning: boolean
  scaffolded: boolean
  missingRequired: string[]
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const webviewRef = useRef<WebviewElement | null>(null)
  const devtoolsPaneRef = useRef<HTMLDivElement | null>(null)
  const autoLoadedRef = useRef(false)
  const [src, setSrc] = useState<string | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [devToolsOpen, setDevToolsOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(true)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)

  const openExternal = trpc.system.openExternal.useMutation()
  const devTools = trpc.system.previewDevTools.useMutation()
  const start = trpc.factory.serverStart.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })
  const stop = trpc.factory.serverStop.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })

  const detected = trpc.terminal.detectUrls.useQuery(
    { ids: ['factory-server'] },
    { enabled: active && serverRunning, refetchInterval: 3000 }
  )

  // Pre-start guard for the crash the raw server gives no help with: a
  // localhost DATABASE_URL nobody is listening on (ECONNREFUSED on boot).
  // Localhost targets only — remote databases are never probed.
  const dbCheck = trpc.factory.dbReachable.useQuery(
    { dir },
    { enabled: active && !serverRunning && scaffolded, refetchInterval: 5000 }
  )
  const dbWarning =
    !serverRunning && scaffolded && dbCheck.data?.checked && !dbCheck.data.reachable
      ? `Nothing is listening on ${dbCheck.data.host}:${dbCheck.data.port} (this checkout's DATABASE_URL) — the server will crash on startup with ECONNREFUSED. Start the local database first (Environment section), or fix DATABASE_URL.`
      : null
  // Gate on serverRunning: the disabled query retains its last data after a
  // stop, which would leave stale URL chips for a dead server.
  const urls = serverRunning ? (detected.data ?? []) : []

  const navigate = (raw: string): void => {
    if (!isLocalhostHttpUrl(raw)) return
    const url = normalizeLocalhostUrl(raw)
    setLoadFailed(null)
    if (url === src) {
      try {
        webviewRef.current?.reload()
      } catch {}
    } else {
      setSrc(url)
    }
  }

  // Auto-load the first detected URL once per server run (reset on stop so a
  // restart re-detects — the port may have changed via .env).
  useEffect(() => {
    if (!serverRunning) autoLoadedRef.current = false
  }, [serverRunning])
  useEffect(() => {
    if (!serverRunning || autoLoadedRef.current || urls.length === 0) return
    autoLoadedRef.current = true
    navigate(urls[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, serverRunning])

  // Webview lifecycle listeners — the element only exists while src is set.
  const mounted = src !== null
  useEffect(() => {
    if (!mounted) return
    const wv = webviewRef.current
    if (!wv) return
    const syncNav = (): void => {
      try {
        setCurrentUrl(wv.getURL())
        setCanBack(wv.canGoBack())
        setCanForward(wv.canGoForward())
        setLoadFailed(null)
      } catch {}
    }
    const onFail = (e: Event): void => {
      const { errorCode, validatedURL } = e as Event & { errorCode: number; validatedURL: string }
      if (errorCode === -3) return // aborted (e.g. superseded navigation)
      setLoadFailed(validatedURL || src || '')
    }
    wv.addEventListener('did-navigate', syncNav)
    wv.addEventListener('did-navigate-in-page', syncNav)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('did-navigate', syncNav)
      wv.removeEventListener('did-navigate-in-page', syncNav)
      wv.removeEventListener('did-fail-load', onFail)
    }
  }, [mounted, src])

  // DevTools dock onto the side pane — same main-process WebContentsView
  // overlay as PreviewView (a <webview> can't host another page's DevTools).
  // When this section/tab is hidden the pane's rect collapses to 0×0, which
  // hides the overlay.
  useEffect(() => {
    if (!devToolsOpen || !mounted) return
    const pane = devtoolsPaneRef.current
    const page = webviewRef.current
    if (!pane || !page) return
    let pageId: number | null = null
    let raf = 0
    const sync = (): void => {
      if (pageId === null) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (pageId === null) return
        const r = pane.getBoundingClientRect()
        devTools.mutate({
          pageWebContentsId: pageId,
          bounds: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height)
          }
        })
      })
    }
    const ro = new ResizeObserver(sync)
    const startOverlay = (): void => {
      try {
        pageId = page.getWebContentsId()
      } catch {
        return // webview not attached yet — dom-ready below retries
      }
      sync()
      ro.observe(pane)
      window.addEventListener('resize', sync)
    }
    startOverlay()
    if (pageId === null) page.addEventListener('dom-ready', startOverlay, { once: true })
    return () => {
      page.removeEventListener('dom-ready', startOverlay)
      ro.disconnect()
      window.removeEventListener('resize', sync)
      cancelAnimationFrame(raf)
      if (pageId !== null) {
        devTools.mutate({ pageWebContentsId: pageId })
        pageId = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devToolsOpen, mounted])

  const call = (fn: (wv: WebviewElement) => void): void => {
    const wv = webviewRef.current
    if (!wv) return
    try {
      fn(wv)
    } catch {}
  }

  const startBlocked = !scaffolded
    ? 'Scaffold the checkout first (Setup section)'
    : missingRequired.length > 0
      ? `Set the required .env keys first (Environment section): ${missingRequired.join(', ')}`
      : null

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        {serverRunning ? (
          <Tip content="Stop the Factory server (kills the npm run dev pty)">
            <span className="inline-flex">
              <Button
                size="sm"
                variant="ghost"
                disabled={stop.isPending}
                onClick={() => stop.mutate()}
              >
                <Square size={12} />
                Stop
              </Button>
            </span>
          </Tip>
        ) : (
          <Tip
            content={
              startBlocked ??
              'Run `npm run dev` in the checkout — the dashboard loads here once its URL appears in the logs'
            }
          >
            <span className="inline-flex">
              <Button
                size="sm"
                disabled={!!startBlocked || start.isPending}
                onClick={() => start.mutate({ dir })}
              >
                <Play size={12} />
                Start server
              </Button>
            </span>
          </Tip>
        )}
        <span
          className={cn(
            'mx-1 h-1.5 w-1.5 shrink-0 rounded-full',
            serverRunning ? 'bg-emerald-500' : 'bg-muted-foreground/40'
          )}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {urls.map((u) => (
            <Tip key={u} content="URL detected in the server logs — click to open it here">
              <button
                onClick={() => navigate(u)}
                className={cn(
                  'shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] cursor-pointer',
                  normalizeLocalhostUrl(u) === src
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {u}
              </button>
            </Tip>
          ))}
        </div>
        <Tip content="Go back">
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              disabled={!canBack}
              onClick={() => call((wv) => wv.goBack())}
            >
              <ArrowLeft size={13} />
            </Button>
          </span>
        </Tip>
        <Tip content="Go forward">
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              disabled={!canForward}
              onClick={() => call((wv) => wv.goForward())}
            >
              <ArrowRight size={13} />
            </Button>
          </span>
        </Tip>
        <Tip content="Reload the dashboard">
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              disabled={!mounted}
              onClick={() => call((wv) => wv.reload())}
            >
              <RotateCw size={13} />
            </Button>
          </span>
        </Tip>
        <Tip
          content={
            devToolsOpen
              ? 'Close the DevTools pane'
              : 'Open DevTools for the dashboard in a side pane'
          }
        >
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              disabled={!mounted}
              className={cn(devToolsOpen && 'bg-accent text-foreground')}
              onClick={() => setDevToolsOpen(!devToolsOpen)}
            >
              <Wrench size={13} />
            </Button>
          </span>
        </Tip>
        <Tip content="Open the dashboard in your browser">
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              disabled={!mounted}
              onClick={() => {
                const url = currentUrl ?? src
                if (url) openExternal.mutate({ url })
              }}
            >
              <ExternalLink size={13} />
            </Button>
          </span>
        </Tip>
        <Tip
          content={logsOpen ? 'Hide the server logs' : 'Show the server logs (npm run dev output)'}
        >
          <Button
            size="icon"
            variant="ghost"
            className={cn(logsOpen && 'bg-accent text-foreground')}
            onClick={() => setLogsOpen(!logsOpen)}
          >
            <ScrollText size={13} />
          </Button>
        </Tip>
      </div>

      {(start.error || stop.error || devTools.error || openExternal.error) && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {start.error?.message ??
            stop.error?.message ??
            (devTools.error ? `DevTools failed: ${devTools.error.message}` : undefined) ??
            `Open in browser failed: ${openExternal.error?.message}`}
        </div>
      )}

      {dbWarning && (
        <div className="shrink-0 border-b border-border bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-500">
          {dbWarning}
        </div>
      )}

      {loadFailed !== null && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          Failed to load {loadFailed || 'the dashboard'} — is the server still starting?
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {src ? (
          <>
            <div className="min-w-0 flex-1">
              <webview
                ref={(el) => {
                  webviewRef.current = el as WebviewElement | null
                }}
                src={src}
                partition="persist:factory"
                className="h-full w-full"
              />
            </div>
            {devToolsOpen && (
              <div ref={devtoolsPaneRef} className="w-[45%] shrink-0 border-l border-border">
                {/* Placeholder: a main-process WebContentsView with the DevTools
                    frontend is overlaid at this element's bounds. This text only
                    shows if that fails. */}
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  DevTools
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
            <Factory size={28} strokeWidth={1.5} />
            <div className="text-sm">Factory dashboard</div>
            <div className="max-w-sm text-xs">
              {startBlocked ??
                (serverRunning
                  ? 'Server starting — waiting for its localhost URL to appear in the logs…'
                  : 'Start the server to load the Factory dashboard here. It stops when Yardarm quits — run `npm run dev` in a standalone terminal for long-lived hosting.')}
            </div>
          </div>
        )}
      </div>

      <FactoryTerminal
        id="factory-server"
        cwd={dir}
        running={serverRunning}
        className={cn('h-56 shrink-0 border-t border-border', !logsOpen && 'hidden')}
      />
    </div>
  )
}
