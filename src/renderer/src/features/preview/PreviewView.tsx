/**
 * Preview tab: embeds localhost dev servers in a hardened <webview> (see
 * window-manager.ts for the attach/navigation policy — localhost only,
 * everything else opens in the system browser). URLs are auto-detected from
 * the chat/project terminals' scrollback via terminal.detectUrls and offered
 * as one-click chips; the URL bar accepts loopback http(s) URLs only.
 */
import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Play,
  RotateCw,
  Square,
  Wrench
} from 'lucide-react'
import { isLocalhostHttpUrl, normalizeLocalhostUrl } from '@shared/localhost-url'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import type { WebviewElement } from './webview'

export function PreviewView({
  terminalIds,
  active,
  cwd,
  devTerminalId
}: {
  /** Terminals whose scrollback is scanned for dev-server URLs. */
  terminalIds: string[]
  /** Whether the tab is visible (gates the detection polling). */
  active: boolean
  /** Project (or chat worktree) directory the dev server runs in. */
  cwd: string
  /** Dedicated pty id for the one-click dev server — must be in terminalIds. */
  devTerminalId: string
}): React.JSX.Element {
  const webviewRef = useRef<WebviewElement | null>(null)
  const autoLoadedRef = useRef(false)
  const [src, setSrc] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)

  // Both actions go through the main process: window.open is unreliable in a
  // sandboxed renderer, and the webview-tag openDevTools() silently no-ops.
  const openExternal = trpc.system.openExternal.useMutation()
  const devTools = trpc.system.previewDevTools.useMutation()

  const detected = trpc.terminal.detectUrls.useQuery(
    { ids: terminalIds },
    { enabled: active && terminalIds.length > 0, refetchInterval: 3000 }
  )
  const urls = detected.data ?? []

  // One-click dev server: a detected `pnpm run dev`-style command runs in a
  // dedicated pty; its exit removes the session, so `exists` is running-state.
  const utils = trpc.useUtils()
  const devCmd = trpc.terminal.devCommand.useQuery({ cwd }, { enabled: active })
  const devRunning = trpc.terminal.exists.useQuery(
    { id: devTerminalId },
    { enabled: active, refetchInterval: 3000 }
  )
  const startDev = trpc.terminal.startDevServer.useMutation({
    onSuccess: () => utils.terminal.exists.invalidate({ id: devTerminalId })
  })
  const stopDev = trpc.terminal.kill.useMutation({
    onSuccess: () => utils.terminal.exists.invalidate({ id: devTerminalId })
  })

  const navigate = (raw: string): void => {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `http://${raw}`
    if (!isLocalhostHttpUrl(candidate)) {
      setInputError('Only localhost http(s) URLs can be previewed')
      return
    }
    const url = normalizeLocalhostUrl(candidate)
    setInputError(null)
    setLoadFailed(null)
    setInput(url)
    if (url === src) {
      try {
        webviewRef.current?.reload()
      } catch {}
    } else {
      setSrc(url)
    }
  }

  // Auto-load the first detected dev-server URL once, if nothing loaded yet.
  useEffect(() => {
    if (autoLoadedRef.current || src || urls.length === 0) return
    autoLoadedRef.current = true
    navigate(urls[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, src])

  // Webview lifecycle listeners — the element only exists while src is set.
  const mounted = src !== null
  useEffect(() => {
    if (!mounted) return
    const wv = webviewRef.current
    if (!wv) return
    const syncNav = (): void => {
      try {
        setCurrentUrl(wv.getURL())
        setInput(wv.getURL())
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

  const call = (fn: (wv: WebviewElement) => void): void => {
    const wv = webviewRef.current
    if (!wv) return
    try {
      fn(wv)
    } catch {}
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
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
        <Tip content="Reload the page">
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
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (input.trim()) navigate(input.trim())
          }}
        >
          <Input
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setInputError(null)
            }}
            placeholder="http://localhost:3000"
            spellCheck={false}
            className={cn('h-6 font-mono text-[11px]', inputError && 'border-destructive')}
          />
        </form>
        <Tip content="Open DevTools for the previewed page">
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              disabled={!mounted}
              onClick={() =>
                call((wv) => devTools.mutate({ webContentsId: wv.getWebContentsId() }))
              }
            >
              <Wrench size={13} />
            </Button>
          </span>
        </Tip>
        <Tip content="Open this URL in your browser">
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
      </div>

      {/* Inline URL-bar rejection + dev-server start/stop + detected URL chips */}
      {(inputError || urls.length > 0 || devCmd.data) && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
          {inputError && <span className="text-[11px] text-destructive">{inputError}</span>}
          {devCmd.data && !devRunning.data && (
            <Tip
              content={`Start the project's dev server (${devCmd.data.command}) and preview it here`}
            >
              <button
                onClick={() => startDev.mutate({ id: devTerminalId, cwd })}
                disabled={startDev.isPending}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <Play size={9} />
                {devCmd.data.command}
              </button>
            </Tip>
          )}
          {devCmd.data && devRunning.data === true && (
            <Tip content="Stop the dev server started from this Preview tab">
              <button
                onClick={() => stopDev.mutate({ id: devTerminalId })}
                disabled={stopDev.isPending}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <Square size={9} />
                stop dev server
              </button>
            </Tip>
          )}
          {startDev.error && (
            <span className="text-[11px] text-destructive">{startDev.error.message}</span>
          )}
          {urls.map((u) => (
            <Tip key={u} content="Dev-server URL detected in a terminal — click to preview it">
              <button
                onClick={() => navigate(u)}
                className={cn(
                  'rounded-full border border-border px-2 py-0.5 font-mono text-[10px] cursor-pointer',
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
      )}

      {loadFailed !== null && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          Failed to load {loadFailed || 'the page'} — is the dev server running?
        </div>
      )}

      <div className="min-h-0 flex-1">
        {src ? (
          <webview
            ref={(el) => {
              webviewRef.current = el as WebviewElement | null
            }}
            src={src}
            partition="preview"
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
            <Globe size={28} strokeWidth={1.5} />
            <div className="text-sm">Preview a local dev server</div>
            <div className="max-w-sm text-xs">
              Start a dev server in the Terminal or via the agent — detected localhost URLs appear
              above. Or type a localhost URL in the address bar.
            </div>
            {devCmd.data && !devRunning.data && (
              <Tip content="Run the project's detected dev script in a background terminal and preview it here">
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  disabled={startDev.isPending}
                  onClick={() => startDev.mutate({ id: devTerminalId, cwd })}
                >
                  <Play size={12} className="mr-1" />
                  Start dev server ({devCmd.data.command})
                </Button>
              </Tip>
            )}
            {devRunning.data === true && (
              <div className="text-xs">Dev server starting — waiting for a localhost URL…</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
