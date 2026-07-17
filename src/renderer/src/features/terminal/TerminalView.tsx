import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { trpc } from '../../lib/trpc'

export function TerminalView({ id, cwd }: { id: string; cwd: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  const [attached, setAttached] = useState(false)
  const create = trpc.terminal.create.useMutation({ onSuccess: () => setAttached(true) })
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
    term.open(el)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    create.mutate({ id, cwd, cols: term.cols, rows: term.rows })

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd])

  trpc.terminal.stream.useSubscription(
    { id },
    {
      enabled: attached,
      onData: (ev) => {
        if (ev.type === 'data') termRef.current?.write(ev.data)
        else termRef.current?.write(`\r\n[process exited: ${ev.code}]\r\n`)
      }
    }
  )

  return <div ref={containerRef} className="h-full w-full bg-[#0a0a0a] p-1" />
}
