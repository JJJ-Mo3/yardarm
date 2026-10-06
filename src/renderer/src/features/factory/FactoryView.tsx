/**
 * Factory tab — harness for a Mastra Factory server checkout
 * (mastra.ai/factory): scaffold it, edit its .env, manage the docker
 * database, and run `npm run dev` with the dashboard embedded in a webview.
 *
 * A thin state machine over factory.getConfig + factory.inspect +
 * factory.status; all real state lives in the main process (app_settings
 * `factory` config, the checkout's .env, and the `factory-*` command ptys).
 * Three tabs: Setup (checklist + scaffold/adopt cards + environment in one
 * scrollable column — checklist buttons scroll to the card that owns the
 * fix), Server, and Work; start/stop controls live in the header so every
 * tab that mentions the server has them in sight. Sections are kept mounted
 * (hidden) so the webview and terminals survive section/tab switches — the
 * component itself is kept mounted by App.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Factory, Loader2, Play, Square } from 'lucide-react'
import type { FactoryMode } from '@shared/ipc-types'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { FactorySetup } from './FactorySetup'
import { FactoryChecklist } from './FactoryChecklist'
import { FactoryEnvEditor } from './FactoryEnvEditor'
import { FactoryDbCard } from './FactoryDbCard'
import { FactoryRunPanel } from './FactoryRunPanel'
import { FactoryWorkPanel } from './FactoryWorkPanel'

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

type Section = 'setup' | 'run' | 'work'

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
  const serverStart = trpc.factory.serverStart.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })
  const serverStop = trpc.factory.serverStop.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })
  const [section, setSection] = useState<Section | null>(null)

  // Scroll targets inside the merged Setup tab, so checklist actions can jump
  // to the card that owns a fix instead of bouncing between tabs.
  const setupScrollRef = useRef<HTMLDivElement | null>(null)
  const setupCardsRef = useRef<HTMLDivElement | null>(null)
  const envCardsRef = useRef<HTMLDivElement | null>(null)

  // Scaffold/install completion: the busy-gated inspect poll stops as soon as
  // status flips, possibly holding pre-completion data — force a final refetch
  // so the checklist, missing-keys badge, and .env rows reflect the result.
  const prevBusy = useRef(false)
  useEffect(() => {
    if (prevBusy.current && !busy) {
      utils.factory.inspect.invalidate()
      utils.factory.envRead.invalidate()
    }
    prevBusy.current = busy
  }, [busy, utils])

  const inspection = dir ? (inspect.data ?? null) : null
  const scaffolded = !!inspection?.scaffolded
  const missing = inspection?.missingRequired ?? []
  const setupIncomplete = !scaffolded || missing.length > 0 || !inspection?.hasNodeModules
  const serverRunning = !!status.data?.serverRunning
  const effective: Section = !dir ? 'setup' : (section ?? (setupIncomplete ? 'setup' : 'run'))

  const goTo = (target: 'setup' | 'env' | 'run' | 'work'): void => {
    if (target === 'run' || target === 'work') {
      setSection(target)
      return
    }
    setSection('setup')
    const el = target === 'env' ? envCardsRef : setupCardsRef
    // Wait a frame so the tab is unhidden before scrolling.
    requestAnimationFrame(() => el.current?.scrollIntoView({ behavior: 'smooth' }))
  }
  const showChecklist = (): void => {
    setSection('setup')
    requestAnimationFrame(() => setupScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  const startBlocked = !scaffolded
    ? 'Scaffold the checkout first (Setup tab)'
    : missing.length > 0
      ? `Set the required .env keys first (Setup tab): ${missing.join(', ')}`
      : null

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
          {dir && scaffolded && (
            <>
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  serverRunning ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                )}
              />
              {serverRunning ? (
                <Tip
                  content="Stop the Factory server and verify its port is actually released"
                  side="bottom"
                >
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      disabled={serverStop.isPending}
                      onClick={() => serverStop.mutate({ dir })}
                    >
                      {serverStop.isPending ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Square size={11} />
                      )}
                      Stop
                    </Button>
                  </span>
                </Tip>
              ) : (
                <Tip content={startBlocked ?? 'Run `npm run dev` in the checkout'} side="bottom">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      disabled={!!startBlocked || serverStart.isPending}
                      onClick={() => serverStart.mutate({ dir })}
                    >
                      {serverStart.isPending ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Play size={11} />
                      )}
                      Start server
                    </Button>
                  </span>
                </Tip>
              )}
              <span className="mx-1 h-4 w-px bg-border" />
            </>
          )}
          {navBtn(
            'setup',
            'Setup',
            'Everything to get this Factory running: guided checklist, scaffold/adopt a checkout, and the .env + database configuration — all on one page',
            dir && scaffolded && missing.length > 0 ? (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-medium text-amber-500">
                {missing.length}
              </span>
            ) : dir && setupIncomplete ? (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            ) : undefined
          )}
          {dir &&
            navBtn(
              'run',
              'Server',
              'Start/stop the Factory server (npm run dev) and use its dashboard in-app',
              serverRunning ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : undefined
            )}
          {dir &&
            navBtn(
              'work',
              'Work',
              'Native Factory client: work board, agent runs, decisions, attention, intake'
            )}
        </div>
      </div>

      {(serverStart.error || serverStop.error) && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {serverStart.error?.message ?? serverStop.error?.message}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <div
          ref={setupScrollRef}
          className={cn('h-full overflow-y-auto', effective !== 'setup' && 'hidden')}
        >
          {dir && (
            <FactoryChecklist
              dir={dir}
              mode={mode}
              active={active && effective === 'setup'}
              inspection={inspection}
              serverRunning={serverRunning}
              scaffoldRunning={!!status.data?.scaffoldRunning}
              installRunning={!!status.data?.installRunning}
              dbRunning={!!status.data?.dbRunning}
              onGoTo={goTo}
            />
          )}
          <div ref={setupCardsRef}>
            <FactorySetup
              dir={dir}
              mode={mode}
              inspection={inspection}
              scaffoldRunning={!!status.data?.scaffoldRunning}
              installRunning={!!status.data?.installRunning}
            />
          </div>
          {dir && (
            <div ref={envCardsRef} className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pt-0">
              <FactoryEnvEditor dir={dir} mode={mode} active={active && effective === 'setup'} />
              {(mode === 'local' || inspection?.hasDbScript || inspection?.hasDockerCompose) && (
                <FactoryDbCard
                  dir={dir}
                  hasDbScript={!!inspection?.hasDbScript}
                  dbRunning={!!status.data?.dbRunning}
                  active={active && effective === 'setup'}
                />
              )}
            </div>
          )}
        </div>
        {dir && (
          <div className={cn('h-full', effective !== 'run' && 'hidden')}>
            <FactoryRunPanel
              dir={dir}
              active={active && effective === 'run'}
              serverRunning={serverRunning}
              scaffolded={scaffolded}
              missingRequired={missing}
              onShowChecklist={showChecklist}
            />
          </div>
        )}
        {dir && (
          <div className={cn('h-full', effective !== 'work' && 'hidden')}>
            <FactoryWorkPanel
              dir={dir}
              active={active && effective === 'work'}
              serverRunning={serverRunning}
              onShowServer={() => setSection('run')}
              onShowChecklist={showChecklist}
            />
          </div>
        )}
      </div>
    </div>
  )
}
