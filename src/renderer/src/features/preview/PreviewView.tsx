/**
 * Preview tab: embeds localhost dev servers in a hardened <webview> (see
 * window-manager.ts for the attach/navigation policy — localhost only,
 * everything else opens in the system browser). URLs are auto-detected from
 * the chat/project terminals' scrollback via terminal.detectUrls and offered
 * as one-click chips; the URL bar accepts loopback http(s) URLs only.
 *
 * "Screenshot to chat" and "Pick element" hand the previewed page to the chat
 * composer as attachments (never auto-sent). Both run in the main process
 * (trpc `preview.*`) against the guest's webContents id — the webview itself
 * gets no preload and no extra privileges.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ExternalLink,
  Globe,
  MousePointerClick,
  Play,
  RotateCw,
  Square,
  Wrench
} from 'lucide-react'
import { preferPortUrls } from '@shared/chat-port'
import { isLocalhostHttpUrl, normalizeLocalhostUrl } from '@shared/localhost-url'
import { composerAttachAtom, mainTabAtom, selectedChatIdAtom } from '../../lib/atoms'
import { encodeBase64Utf8, type ComposerAttachment } from '../agents/attachments'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import type { WebviewElement } from './webview'

/** Why a pick ended without a selection, when that is worth telling the user. */
const PICK_CANCEL_NOTICE: Record<string, string | undefined> = {
  navigated: 'Element pick cancelled: the page navigated.',
  gone: 'Element pick cancelled: the previewed page went away.',
  timeout: 'Element pick timed out. Nothing was attached.',
  invalid: 'The page returned an unexpected result. Nothing was attached.'
}

export function PreviewView({
  terminalIds,
  active,
  cwd,
  devTerminalId,
  projectId
}: {
  /** Terminals whose scrollback is scanned for dev-server URLs. */
  terminalIds: string[]
  /** Whether the tab is visible (gates the detection polling). */
  active: boolean
  /** Project (or chat worktree) directory the dev server runs in. */
  cwd: string
  /** Dedicated pty id for the one-click dev server — must be in terminalIds. */
  devTerminalId: string
  /** Project whose env vars (Project Settings → Environment) to inject. */
  projectId?: string | null
}): React.JSX.Element {
  const webviewRef = useRef<WebviewElement | null>(null)
  const devtoolsPaneRef = useRef<HTMLDivElement | null>(null)
  const autoLoadedRef = useRef(false)
  const [src, setSrc] = useState<string | null>(null)
  const [devToolsOpen, setDevToolsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)

  // Both actions go through the main process: window.open is unreliable in a
  // sandboxed renderer, and the webview-tag openDevTools() silently no-ops.
  // DevTools render in a main-process WebContentsView overlaid on the
  // right-side placeholder pane (devtoolsPaneRef) — see the bounds-sync
  // effect below.
  const openExternal = trpc.system.openExternal.useMutation()
  const devTools = trpc.system.previewDevTools.useMutation()

  // Screenshot / element pick → composer attachments. They need a chat to
  // land in (the composer only exists on a chat), and switch to the Chat tab
  // afterwards like the other "send to composer" actions.
  const chatId = useAtomValue(selectedChatIdAtom)
  const setComposerAttach = useSetAtom(composerAttachAtom)
  const setMainTab = useSetAtom(mainTabAtom)
  const capture = trpc.preview.capture.useMutation()
  const pick = trpc.preview.pickElement.useMutation()
  const cancelPick = trpc.preview.cancelPick.useMutation()
  const [picking, setPicking] = useState(false)
  const [pickNotice, setPickNotice] = useState<string | null>(null)
  /** Guest the running pick was started on (cancel must target the same one). */
  const pickPageIdRef = useRef<number | null>(null)
  /** Bumped on every start and on context change, so stale results are dropped. */
  const attachRunRef = useRef(0)

  const detected = trpc.terminal.detectUrls.useQuery(
    { ids: terminalIds },
    { enabled: active && terminalIds.length > 0, refetchInterval: 3000 }
  )
  // Each chat has its own port (YARDARM_PORT); URLs on it are listed — and
  // auto-loaded — first. A project that hard-codes another port still shows
  // up: every detected URL stays in the list.
  const devPort = trpc.terminal.devPort.useQuery(
    { id: devTerminalId, projectId: projectId ?? undefined },
    { enabled: active }
  )
  const chatPort = devPort.data?.port ?? null
  const urls = preferPortUrls(detected.data ?? [], chatPort)

  // One-click dev server: a detected `pnpm run dev`-style command runs in a
  // dedicated pty; its exit removes the session, so `exists` is running-state.
  const utils = trpc.useUtils()
  const devCmd = trpc.terminal.devCommand.useQuery(
    { cwd, id: devTerminalId, projectId: projectId ?? undefined },
    { enabled: active }
  )
  const devRunning = trpc.terminal.exists.useQuery(
    { id: devTerminalId },
    { enabled: active, refetchInterval: 3000 }
  )
  const startDev = trpc.terminal.startDevServer.useMutation({
    onSuccess: () => {
      utils.terminal.exists.invalidate({ id: devTerminalId })
      utils.terminal.otherDevServers.invalidate()
    }
  })
  const stopDev = trpc.terminal.kill.useMutation({
    onSuccess: () => utils.terminal.exists.invalidate({ id: devTerminalId })
  })

  // Dev servers started from other chats' Preview tabs keep running across
  // chat switches. Each chat has its own port, so they normally run side by
  // side; this lists only the ones that would fight this chat's server for a
  // port (same port, or a project that ignores the assigned port) — the start
  // action stops those first and the copy says so.
  const otherDev = trpc.terminal.otherDevServers.useQuery(
    { excludeId: devTerminalId, projectId: projectId ?? undefined },
    { enabled: active, refetchInterval: 3000 }
  )
  const otherServers = otherDev.data ?? []
  const startDevHere = (): void =>
    startDev.mutate({
      id: devTerminalId,
      cwd,
      stopIds: otherServers.map((o) => o.id),
      projectId: projectId ?? undefined
    })
  const portNote = chatPort !== null ? ` (asked to use port ${chatPort})` : ''
  const startDevTip = (command: string): string =>
    otherServers.length > 0
      ? `Stop the dev server still running in ${otherServers
          .map((o) => o.label)
          .join(
            ' and '
          )} (it would clash with this one over the same port), then run \`${command}\` here${portNote}`
      : `Run \`${command}\` in a background terminal and preview it here${portNote}`

  // The component stays mounted while chatId/projectId change (App keeps the
  // Preview tab alive across tab switches), so reset per-context state when
  // the context changes — otherwise the old chat's page keeps showing while
  // the chips and dev-server controls act on the new one.
  useEffect(() => {
    autoLoadedRef.current = false
    setSrc(null)
    setDevToolsOpen(false)
    setInput('')
    setInputError(null)
    setCurrentUrl(null)
    setCanBack(false)
    setCanForward(false)
    setLoadFailed(null)
    openExternal.reset()
    devTools.reset()
    // An in-flight capture or pick belongs to the previous chat: drop its
    // result (run counter) and stop the picker in the page.
    attachRunRef.current++
    stopPicking()
    pickPageIdRef.current = null
    setPicking(false)
    setPickNotice(null)
    capture.reset()
    pick.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devTerminalId])

  // Unmount: don't leave a picker running in a page nobody can see.
  useEffect(() => {
    // The counter is a plain value, not a DOM ref: bumping it at cleanup time
    // is the point (a result arriving after unmount must not be attached).
    const runs = attachRunRef
    return () => {
      runs.current++
      stopPicking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc cancels a pick. The picker handles Esc itself while the page has
  // focus; this covers focus being anywhere in the app window instead.
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      stopPicking()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking])

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

  // Dock DevTools onto the side pane: a <webview> can't host another page's
  // DevTools (Electron never injects the DevToolsAPI embedder binding into
  // guest webContents — electron/electron#15874), so the main process overlays
  // a WebContentsView on the placeholder pane instead. This keeps the
  // overlay's bounds in sync with the placeholder (rAF-coalesced) and closes
  // it on toggle-off/unmount. When the Preview tab is hidden (it stays
  // mounted), the rect collapses to 0×0, which hides the overlay.
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
    const start = (): void => {
      try {
        pageId = page.getWebContentsId()
      } catch {
        return // webview not attached yet — dom-ready below retries
      }
      sync()
      ro.observe(pane)
      window.addEventListener('resize', sync)
    }
    start()
    if (pageId === null) page.addEventListener('dom-ready', start, { once: true })
    return () => {
      page.removeEventListener('dom-ready', start)
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

  /** The guest's webContents id, or null while the webview isn't attached. */
  const guestId = (): number | null => {
    try {
      return webviewRef.current?.getWebContentsId() ?? null
    } catch {
      return null
    }
  }

  // Function declaration (hoisted): the reset/unmount/Esc effects above call it.
  function stopPicking(): void {
    const id = pickPageIdRef.current
    if (id !== null) cancelPick.mutate({ pageWebContentsId: id })
  }

  const screenshotToChat = async (): Promise<void> => {
    const id = guestId()
    if (id === null) return
    const run = ++attachRunRef.current
    setPickNotice(null)
    pick.reset()
    try {
      const image = await capture.mutateAsync({ pageWebContentsId: id })
      if (run !== attachRunRef.current) return
      setComposerAttach({
        data: image.data,
        mediaType: image.mediaType,
        filename: `preview-screenshot.${image.mediaType === 'image/png' ? 'png' : 'jpg'}`
      })
      setMainTab('chat')
    } catch {
      // Shown through capture.error below.
    }
  }

  const startPicking = async (): Promise<void> => {
    const id = guestId()
    if (id === null) return
    const run = ++attachRunRef.current
    pickPageIdRef.current = id
    setPicking(true)
    setPickNotice(null)
    capture.reset()
    // Focus the page so Esc reaches the picker without an extra click.
    call((wv) => wv.focus())
    try {
      const result = await pick.mutateAsync({ pageWebContentsId: id })
      if (run !== attachRunRef.current) return
      if (result.status === 'cancelled') {
        setPickNotice(PICK_CANCEL_NOTICE[result.reason] ?? null)
        return
      }
      const attachments: ComposerAttachment[] = [
        {
          data: encodeBase64Utf8(result.text),
          mediaType: 'text/plain',
          filename: 'preview-element.txt'
        }
      ]
      if (result.image) {
        attachments.push({
          data: result.image.data,
          mediaType: result.image.mediaType,
          filename: `preview-element.${result.image.mediaType === 'image/png' ? 'png' : 'jpg'}`
        })
      } else {
        setPickNotice(
          `Attached ${result.label} without a screenshot: the element could not be captured.`
        )
      }
      setComposerAttach(attachments)
      setMainTab('chat')
    } catch {
      // Shown through pick.error below.
    } finally {
      if (run === attachRunRef.current) {
        pickPageIdRef.current = null
        setPicking(false)
      }
    }
  }

  const attachBlocked = !mounted
    ? ' (load a page first)'
    : !chatId
      ? ' (open a chat first: attachments go to its composer)'
      : ''

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <Tip content="Go back">
          <span className="inline-flex">
            <Button
              aria-label="Go back"
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
              aria-label="Go forward"
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
              aria-label="Reload page"
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
        <Tip
          content={
            picking
              ? 'Finish or cancel the element pick first'
              : `Capture the visible page and attach the image to the chat composer${attachBlocked}`
          }
        >
          <span className="inline-flex">
            <Button
              aria-label="Screenshot to chat"
              size="icon"
              variant="ghost"
              disabled={!mounted || !chatId || picking || capture.isPending}
              onClick={() => void screenshotToChat()}
            >
              <Camera size={13} />
            </Button>
          </span>
        </Tip>
        <Tip
          content={
            picking
              ? 'Cancel picking (Esc)'
              : `Pick element: click an element in the page to attach its selector, styles, HTML and a cropped screenshot to the chat composer${attachBlocked}`
          }
        >
          <span className="inline-flex">
            <Button
              aria-label={picking ? 'Cancel element pick' : 'Pick element'}
              aria-pressed={picking}
              size="icon"
              variant="ghost"
              disabled={!mounted || !chatId || capture.isPending}
              className={cn(picking && 'bg-accent text-foreground')}
              onClick={() => (picking ? stopPicking() : void startPicking())}
            >
              <MousePointerClick size={13} />
            </Button>
          </span>
        </Tip>
        <Tip
          content={
            devToolsOpen
              ? 'Close the DevTools pane'
              : mounted
                ? 'Open DevTools for the previewed page in a side pane'
                : 'Open DevTools for the previewed page (load a page first)'
          }
        >
          <span className="inline-flex">
            <Button
              aria-label={devToolsOpen ? 'Close DevTools' : 'Open DevTools'}
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
        <Tip
          content={
            mounted
              ? 'Open this URL in your browser'
              : 'Open this URL in your browser (load a page first)'
          }
        >
          <span className="inline-flex">
            <Button
              aria-label="Open in browser"
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

      {/* Toolbar-action failures were previously swallowed — make them visible. */}
      {(devTools.error || openExternal.error) && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {devTools.error
            ? `DevTools failed: ${devTools.error.message}`
            : `Open in browser failed: ${openExternal.error?.message}`}
        </div>
      )}

      {/* Element pick in progress: say what to do and offer a way out. */}
      {picking && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent/40 px-3 py-1.5 text-xs">
          <MousePointerClick size={12} className="shrink-0" />
          <span className="min-w-0 flex-1">
            Pick element: hover to highlight, click to attach it to the chat. Esc cancels.
          </span>
          <Tip content="Stop picking without attaching anything">
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={stopPicking}>
              Cancel
            </Button>
          </Tip>
        </div>
      )}
      {(capture.error || pick.error || cancelPick.error) && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive selectable">
          {capture.error
            ? `Screenshot failed: ${capture.error.message}`
            : pick.error
              ? `Pick element failed: ${pick.error.message}`
              : `Cancelling the pick failed: ${cancelPick.error?.message}`}
        </div>
      )}
      {pickNotice && !picking && (
        <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground selectable">
          {pickNotice}
        </div>
      )}

      {/* Inline URL-bar rejection + dev-server start/stop + detected URL chips */}
      {(inputError || urls.length > 0 || devCmd.data) && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
          {inputError && <span className="text-[11px] text-destructive">{inputError}</span>}
          {/* devRunning.isSuccess gates the chip so it can't flash "start"
              while the running-state query is still loading. */}
          {devCmd.data && devRunning.isSuccess && !devRunning.data && (
            <Tip content={startDevTip(devCmd.data.command)}>
              <span className="inline-flex">
                <button
                  onClick={startDevHere}
                  disabled={startDev.isPending}
                  className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                >
                  <Play size={9} />
                  start {devCmd.data.label}
                </button>
              </span>
            </Tip>
          )}
          {devCmd.data && devRunning.data === true && (
            <Tip content={`Stop the ${devCmd.data.label} started from this Preview tab`}>
              <span className="inline-flex">
                <button
                  onClick={() => stopDev.mutate({ id: devTerminalId })}
                  disabled={stopDev.isPending}
                  className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                >
                  <Square size={9} />
                  stop {devCmd.data.label}
                </button>
              </span>
            </Tip>
          )}
          {(startDev.error || stopDev.error) && (
            <span className="text-[11px] text-destructive">
              {startDev.error?.message ?? stopDev.error?.message}
            </span>
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

      <div className="flex min-h-0 flex-1">
        {src ? (
          <>
            <div className="min-w-0 flex-1">
              <webview
                ref={(el) => {
                  webviewRef.current = el as WebviewElement | null
                }}
                src={src}
                partition="preview"
                className="h-full w-full"
              />
            </div>
            {devToolsOpen && (
              <div ref={devtoolsPaneRef} className="w-[45%] shrink-0 border-l border-border">
                {/* Placeholder: a main-process WebContentsView with the DevTools
                    frontend is overlaid at this element's bounds (see the
                    bounds-sync effect). This text only shows if that fails. */}
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  DevTools
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
            <Globe size={28} strokeWidth={1.5} />
            <div className="text-sm">Preview a local dev server</div>
            <div className="max-w-sm text-xs">
              Start a dev server in the Terminal or via the agent — detected localhost URLs appear
              above. Or type a localhost URL in the address bar.
            </div>
            {devCmd.data && devRunning.isSuccess && !devRunning.data && otherServers.length > 0 && (
              <div className="max-w-sm text-xs">
                A dev server started from {otherServers.map((o) => o.label).join(' and ')} is still
                running and would use the same port. Starting one here stops it first.
              </div>
            )}
            {devCmd.data && devRunning.isSuccess && !devRunning.data && (
              <Tip content={startDevTip(devCmd.data.command)}>
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1"
                    disabled={startDev.isPending}
                    onClick={startDevHere}
                  >
                    <Play size={12} className="mr-1" />
                    Start {devCmd.data.label}
                  </Button>
                </span>
              </Tip>
            )}
            {devRunning.data === true && (
              <div className="text-xs">Dev server starting — waiting for a localhost URL…</div>
            )}
            {devCmd.isSuccess && !devCmd.data && (
              <div className="max-w-sm text-xs">
                One-click start is unavailable: no dev/serve/start script in package.json and no
                .html files in the project root were found.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
