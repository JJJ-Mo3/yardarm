/**
 * Factory local-database card — start/stop the checkout's docker-compose
 * Postgres (pgvector) + Redis via its `npm run db:up` / `db:down` scripts,
 * with docker detection and an attached command terminal.
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
  const docker = trpc.factory.dockerStatus.useQuery(undefined, { enabled: active })
  const invalidate = (): void => {
    utils.factory.status.invalidate()
  }
  const dbUp = trpc.factory.dbUp.useMutation({ onSuccess: invalidate })
  const dbDown = trpc.factory.dbDown.useMutation({ onSuccess: invalidate })
  const dockerMissing = docker.isSuccess && !docker.data.dockerPath
  const blocked = !hasDbScript
    ? 'This checkout has no db:up script — manage its database yourself or re-scaffold'
    : dbRunning
      ? 'A database command is still running (see the terminal below)'
      : null

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
      {dockerMissing && (
        <div className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
          Docker not found — it is required for the bundled Postgres/Redis. Install Docker Desktop,
          or point DATABASE_URL at your own Postgres with the pgvector extension.
        </div>
      )}
      {(dbUp.error || dbDown.error) && (
        <div className="mt-2 text-[11px] text-destructive">
          {dbUp.error?.message ?? dbDown.error?.message}
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
