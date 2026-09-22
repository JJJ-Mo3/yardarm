/**
 * xterm.js terminal bound to a main-process pty (shell or the Mastra CLI),
 * with an in-buffer search overlay (Cmd/Ctrl+F while the terminal is focused).
 */
import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Tip } from '../../components/ui/tooltip'
import { trpc } from '../../lib/trpc'

const SEARCH_DECORATIONS = {
  matchBackground: '#facc1533',
  matchBorder: '#facc15',
  matchOverviewRuler: '#facc15',
  activeMatchBackground: '#f9731666',
  activeMatchBorder: '#f97316',
  activeMatchColorOverviewRuler: '#f97316'
}

export function TerminalView({
  id,
  cwd,
  kind = 'shell'
}: {
  id: string
  cwd: string
  kind?: 'shell' | 'mastracode'
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  // The id the pty was actually created for: on a chat switch the id prop
  // changes without a remount, and subscribing before terminal.create for
  // the new id completes would register no-op listeners (dead terminal) —
  // pty-manager's onData/onExit are no-ops for ids that don't exist yet.
  const [attachedId, setAttachedId] = useState<string | null>(null)
  const create = trpc.terminal.create.useMutation({
    onSuccess: (_data, vars) => setAttachedId(vars.id),
    onError: (e) => termRef.current?.write(`\r\n[failed to start: ${e.message}]\r\n`)
  })
  const write = trpc.terminal.write.useMutation()
  const resize = trpc.terminal.resize.useMutation()

  // Mount xterm once per terminal id.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: true,
      theme: {
        background: '#0a0a0a',
        foreground: '#ededed'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    const search = new SearchAddon()
    term.loadAddon(search)
    term.open(el)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    // Cmd/Ctrl+F opens the search overlay instead of reaching the pty.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.select())
        return false
      }
      return true
    })

    create.mutate({ id, cwd, cols: term.cols, rows: term.rows, kind })

    const onDataDisposable = term.onData((data) => write.mutate({ id, data }))

    const observer = new ResizeObserver(() => {
      fit.fit()
      resize.mutate({ id, cols: term.cols, rows: term.rows })
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      onDataDisposable.dispose()
      term.dispose()
      termRef.current = null
      searchRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd, kind])

  trpc.terminal.stream.useSubscription(
    { id },
    {
      enabled: attachedId === id,
      onData: (ev) => {
        if (ev.type === 'data') termRef.current?.write(ev.data)
        else {
          termRef.current?.write(`\r\n[process exited: ${ev.code}]\r\n`)
          if (kind === 'mastracode')
            termRef.current?.write('[switch tabs and back to restart the Mastra CLI]\r\n')
        }
      }
    }
  )

  function findNext(text: string, incremental = false): void {
    if (!text) {
      searchRef.current?.clearDecorations()
      return
    }
    searchRef.current?.findNext(text, { incremental, decorations: SEARCH_DECORATIONS })
  }

  function findPrevious(text: string): void {
    if (!text) return
    searchRef.current?.findPrevious(text, { decorations: SEARCH_DECORATIONS })
  }

  function closeSearch(): void {
    setSearchOpen(false)
    setQuery('')
    searchRef.current?.clearDecorations()
    termRef.current?.focus()
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-[#0a0a0a] p-1" />
      {searchOpen && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1 shadow-lg">
          <input
            ref={searchInputRef}
            autoFocus
            value={query}
            placeholder="Find in terminal…"
            onChange={(e) => {
              setQuery(e.target.value)
              findNext(e.target.value, true)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                if (e.shiftKey) findPrevious(query)
                else findNext(query)
              } else if (e.key === 'Escape') {
                closeSearch()
              }
            }}
            className="w-40 bg-transparent text-[12px] focus:outline-none placeholder:text-muted-foreground"
          />
          <Tip content="Previous match (Shift+Enter)">
            <button
              onClick={() => findPrevious(query)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <ChevronUp size={13} />
            </button>
          </Tip>
          <Tip content="Next match (Enter)">
            <button
              onClick={() => findNext(query)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <ChevronDown size={13} />
            </button>
          </Tip>
          <Tip content="Close search (Esc)">
            <button
              onClick={closeSearch}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X size={13} />
            </button>
          </Tip>
        </div>
      )}
    </div>
  )
}
