/**
 * Factory local-database card — start/stop the checkout's docker-compose
 * Postgres (pgvector) + Redis via its `npm run db:up` / `db:down` scripts,
 * with docker health detection (CLI / daemon / compose plugin, each with
 * targeted guidance and a one-click runtime start when one is detected)
 * and an attached command terminal.
 */
import React from 'react'
import { Database, Play, Square } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { FactoryTerminal } from './FactoryTerminal'

export function FactoryDbCard({
  dir,
  hasDbScript,
  dbRunning,
  active
}: {
  dir: string
  hasDbScript: boolean
  dbRunning: boolean
  active: boolean
}): React.JSX.Element {
  const utils = trpc.useUtils()
  // Poll while unhealthy so the banner clears by itself once docker comes up
  // (e.g. after the Start button below, or the user fixing it externally).
  const docker = trpc.factory.dockerStatus.useQuery(undefined, {
    enabled: active,
    refetchInterval: (q) =>
      active && q.state.data && (!q.state.data.daemonRunning || !q.state.data.composeAvailable)
        ? 3000
        : false
  })
  const invalidate = (): void => {
    utils.factory.status.invalidate()
  }
  const dbUp = trpc.factory.dbUp.useMutation({ onSuccess: invalidate })
  const dbDown = trpc.factory.dbDown.useMutation({ onSuccess: invalidate })
  const startRuntime = trpc.factory.dockerStartRuntime.useMutation({ onSuccess: invalidate })

  const d = docker.isSuccess ? docker.data : null
  const dockerBlocked = !d
    ? null
    : !d.dockerPath
      ? 'Docker is not installed (see below)'
      : !d.daemonRunning
        ? 'Docker is not running (see below)'
        : !d.composeAvailable
          ? 'The docker compose plugin is missing (see below)'
          : null
  const dockerHelp = !d
    ? null
    : !d.dockerPath
      ? 'Docker not found — the bundled Postgres/Redis need it. Install Docker Desktop or OrbStack (or `brew install docker colima`), then come back — or point DATABASE_URL at your own Postgres with the pgvector extension.'
      : !d.daemonRunning
        ? d.runtime
          ? `Docker isn't running — its daemon has to be up before the database can start. ${d.runtime.label} is installed; the button starts it here.`
          : "Docker isn't running — start your Docker runtime (Docker Desktop, OrbStack, or `colima start`), then come back."
        : !d.composeAvailable
          ? 'The `docker compose` plugin is missing — `npm run db:up` needs it. Docker Desktop and OrbStack bundle it; with a plain homebrew CLI, `brew install docker-compose` and add "/opt/homebrew/lib/docker/cli-plugins" to `cliPluginsExtraDirs` in ~/.docker/config.json.'
          : null

  const blocked = !hasDbScript
    ? 'This checkout has no db:up script — manage its database yourself or re-scaffold'
    : dbRunning
      ? 'A database command is still running (see the terminal below)'
      : dockerBlocked

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Database size={13} className="shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">Local database</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Tip
            content={blocked ?? 'Run `npm run db:up` — starts the docker-compose Postgres/Redis'}
          >
            <span className="inline-flex">
              <Button
                size="sm"
                variant="outline"
                disabled={!!blocked || dbUp.isPending}
                onClick={() => dbUp.mutate({ dir })}
              >
                <Play size={12} />
                Start database
              </Button>
            </span>
          </Tip>
          <Tip content={blocked ?? 'Run `npm run db:down` — stops the docker-compose containers'}>
            <span className="inline-flex">
              <Button
                size="sm"
                variant="ghost"
                disabled={!!blocked || dbDown.isPending}
                onClick={() => dbDown.mutate({ dir })}
              >
                <Square size={12} />
                Stop
              </Button>
            </span>
          </Tip>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Factory's bundled Postgres (with pgvector) and Redis run in Docker via the checkout's
        docker-compose file. Container state persists across commands — “Start database” brings the
        containers up, then exits.
      </p>
      {dockerHelp && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
          <span className="min-w-0 flex-1">{dockerHelp}</span>
          {d && !d.daemonRunning && d.dockerPath && d.runtime && (
            <Tip
              content={`Run \`${d.runtime.id === 'colima' ? 'colima start' : `open -a ${d.runtime.label}`}\` in the terminal below — this card re-checks Docker until the daemon is up`}
            >
              <span className="inline-flex shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={dbRunning || startRuntime.isPending}
                  onClick={() => startRuntime.mutate({ dir })}
                >
                  <Play size={12} />
                  Start {d.runtime.label}
                </Button>
              </span>
            </Tip>
          )}
        </div>
      )}
      {(dbUp.error || dbDown.error || startRuntime.error) && (
        <div className="mt-2 text-[11px] text-destructive">
          {dbUp.error?.message ?? dbDown.error?.message ?? startRuntime.error?.message}
        </div>
      )}
      <FactoryTerminal
        id="factory-db"
        cwd={dir}
        running={dbRunning}
        className="mt-3 h-48 overflow-hidden rounded-md border border-border"
      />
    </div>
  )
}
