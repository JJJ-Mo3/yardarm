/**
 * Factory tab — harness for a Mastra Factory server checkout
 * (mastra.ai/factory): scaffold it, edit its .env, manage the docker
 * database, and run `npm run dev` with the dashboard embedded in a webview.
 *
 * A thin state machine over factory.getConfig + factory.inspect +
 * factory.status; all real state lives in the main process (app_settings
 * `factory` config, the checkout's .env, and the `factory-*` command ptys).
 * Sections are kept mounted (hidden) so the webview and terminals survive
 * section/tab switches — the component itself is kept mounted by App.
 */
import React, { useState } from 'react'
import { Factory } from 'lucide-react'
import type { FactoryMode } from '@shared/ipc-types'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Tip } from '../../components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { FactorySetup } from './FactorySetup'
import { FactoryEnvEditor } from './FactoryEnvEditor'
import { FactoryDbCard } from './FactoryDbCard'
import { FactoryRunPanel } from './FactoryRunPanel'

/** factory.inspect output shape (structural — keep in sync with the router). */
export interface FactoryInspection {
  dirExists: boolean
  scaffolded: boolean
  hasEnv: boolean
  hasEnvExample: boolean
  hasNodeModules: boolean
  hasDockerCompose: boolean
  hasDbScript: boolean
  detectedMode: 'platform' | 'local' | 'unknown'
  missingRequired: string[]
}

type Section = 'setup' | 'env' | 'run'

export function FactoryView({ active }: { active: boolean }): React.JSX.Element {
  const utils = trpc.useUtils()
  const config = trpc.factory.getConfig.useQuery()
  const status = trpc.factory.status.useQuery(undefined, {
    enabled: active,
    refetchInterval: active ? 3000 : false
  })
  const dir = config.data?.dir ?? null
  const mode: FactoryMode = config.data?.mode ?? 'platform'
  const busy = !!status.data?.scaffoldRunning || !!status.data?.installRunning
  const inspect = trpc.factory.inspect.useQuery(
    { dir: dir ?? '', mode },
    { enabled: active && !!dir, refetchInterval: active && busy ? 2500 : false }
  )
  const setConfig = trpc.factory.setConfig.useMutation({
    onSuccess: () => {
      utils.factory.getConfig.invalidate()
      utils.factory.inspect.invalidate()
    }
  })
  const [section, setSection] = useState<Section | null>(null)

  const inspection = dir ? (inspect.data ?? null) : null
  const scaffolded = !!inspection?.scaffolded
  const missing = inspection?.missingRequired ?? []
  const effective: Section = !dir
    ? 'setup'
    : (section ?? (!scaffolded ? 'setup' : missing.length > 0 ? 'env' : 'run'))

  const navBtn = (id: Section, label: string, tip: string, badge?: React.ReactNode) => (
    <Tip key={id} content={tip} side="bottom">
      <button
        onClick={() => setSection(id)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs cursor-pointer',
          effective === id ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {label}
        {badge}
      </button>
    </Tip>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Factory size={14} className="shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium">Mastra Factory</span>
        {dir && (
          <span
            title={dir}
            className="max-w-72 truncate font-mono text-[11px] text-muted-foreground"
          >
            {dir}
          </span>
        )}
        {dir && (
          <Select value={mode} onValueChange={(v) => setConfig.mutate({ mode: v as FactoryMode })}>
            <Tip
              content="How this Factory is hosted: Mastra platform (sign-in during setup, hosted Postgres and cloud sandboxes) or local self-hosted (Docker Postgres, local sandboxes). Changes which .env keys are required."
              side="bottom"
            >
              <SelectTrigger className="h-6 text-[11px]">
                <SelectValue />
              </SelectTrigger>
            </Tip>
            <SelectContent>
              <SelectItem value="platform">Platform</SelectItem>
              <SelectItem value="local">Local self-hosted</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-1">
          {navBtn(
            'setup',
            'Setup',
            'Scaffold a new Factory server checkout or point Yardarm at an existing one'
          )}
          {dir &&
            navBtn(
              'env',
              'Environment',
              'Edit the checkout’s .env — credentials, database, port, sandboxes',
              missing.length > 0 && scaffolded ? (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-medium text-amber-500">
                  {missing.length}
                </span>
              ) : undefined
            )}
          {dir &&
            navBtn(
              'run',
              'Server',
              'Start/stop the Factory server (npm run dev) and use its dashboard in-app',
              status.data?.serverRunning ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : undefined
            )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className={cn('h-full overflow-y-auto', effective !== 'setup' && 'hidden')}>
          <FactorySetup
            dir={dir}
            mode={mode}
            inspection={inspection}
            scaffoldRunning={!!status.data?.scaffoldRunning}
            installRunning={!!status.data?.installRunning}
          />
        </div>
        {dir && (
          <div className={cn('h-full overflow-y-auto', effective !== 'env' && 'hidden')}>
            <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
              <FactoryEnvEditor dir={dir} mode={mode} active={active && effective === 'env'} />
              {(mode === 'local' || inspection?.hasDbScript || inspection?.hasDockerCompose) && (
                <FactoryDbCard
                  dir={dir}
                  hasDbScript={!!inspection?.hasDbScript}
                  dbRunning={!!status.data?.dbRunning}
                  active={active && effective === 'env'}
                />
              )}
            </div>
          </div>
        )}
        {dir && (
          <div className={cn('h-full', effective !== 'run' && 'hidden')}>
            <FactoryRunPanel
              dir={dir}
              active={active && effective === 'run'}
              serverRunning={!!status.data?.serverRunning}
              scaffolded={scaffolded}
              missingRequired={missing}
            />
          </div>
        )}
      </div>
    </div>
  )
}
