/**
 * Terminal wrapper for the router-created `factory-*` command ptys.
 *
 * TerminalView calls terminal.create on mount, which would spawn a stray bare
 * shell if the command pty doesn't exist yet — so this mounts the terminal
 * only once the pty is observed running (create then no-ops into an attach),
 * keeps it mounted after exit so the tail output stays readable, and remounts
 * (via key) on each false→true running transition so a fresh run gets a fresh
 * stream subscription (the old one is bound to the dead pty's emitter).
 */
import React, { useEffect, useRef, useState } from 'react'
import { TerminalView } from '../terminal/TerminalView'

export function FactoryTerminal({
  id,
  cwd,
  running,
  className
}: {
  id: string
  cwd: string
  running: boolean
  className?: string
}): React.JSX.Element | null {
  const [gen, setGen] = useState(0)
  const prevRunning = useRef(false)
  useEffect(() => {
    if (running && !prevRunning.current) setGen((g) => g + 1)
    prevRunning.current = running
  }, [running])
  if (gen === 0) return null
  return (
    <div className={className}>
      <TerminalView key={gen} id={id} cwd={cwd} />
    </div>
  )
}
