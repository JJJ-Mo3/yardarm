/**
 * Terminal wrapper for the router-created `factory-*` command ptys.
 *
 * TerminalView calls terminal.create on mount, which would spawn a stray bare
 * shell if the command pty doesn't exist yet — so this mounts the terminal
 * only once there is something to attach to, with attachOnly so create never
 * spawns. "Something to attach to" is a running pty (status poll) or retained
 * output from an already-finished run (hasOutput — short commands like
 * `npm run db:up` can exit before the poll ever observes them, and their
 * output/errors must stay visible). Remounts (via key) on each false→true
 * running transition so a fresh run gets a fresh stream subscription (the old
 * one is bound to the dead pty's emitter).
 */
import React, { useEffect, useRef, useState } from 'react'
import { trpc } from '../../lib/trpc'
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
  // Finished-run output from before this mount (or a run the status poll
  // missed entirely): poll while unmounted so the tail shows up regardless.
  const hasOutput = trpc.terminal.hasOutput.useQuery(
    { id },
    { enabled: gen === 0, refetchInterval: 2000 }
  )
  useEffect(() => {
    if (hasOutput.data) setGen((g) => (g === 0 ? 1 : g))
  }, [hasOutput.data])
  if (gen === 0) return null
  return (
    <div className={className}>
      <TerminalView key={gen} id={id} cwd={cwd} attachOnly />
    </div>
  )
}
