/**
 * Factory Setup section — connect Yardarm to a Factory server checkout:
 * show the current checkout's health, scaffold a new one with
 * `npm create factory@latest` (interactive pty — platform mode runs a
 * browser sign-in), or adopt an existing folder (mode auto-detected).
 */
import React, { useState } from 'react'
import { AlertTriangle, Check, Download, FolderOpen, Hammer, Unplug, X } from 'lucide-react'
import type { FactoryMode } from '@shared/ipc-types'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import { FactoryTerminal } from './FactoryTerminal'
import type { FactoryInspection } from './FactoryView'

function parentOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : '/'
}

export function FactorySetup({
  dir,
  mode,
  inspection,
  scaffoldRunning,
  installRunning
}: {
  dir: string | null
  mode: FactoryMode
  inspection: FactoryInspection | null
  scaffoldRunning: boolean
  installRunning: boolean
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const pick = trpc.projects.pickFolder.useMutation()
  const setConfig = trpc.factory.setConfig.useMutation({
    onSuccess: () => {
      utils.factory.getConfig.invalidate()
      utils.factory.inspect.invalidate()
    }
  })
  const scaffold = trpc.factory.scaffold.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })
  const install = trpc.factory.install.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })

  const [parent, setParent] = useState<string | null>(null)
  const [name, setName] = useState('factory-server')
  const [newMode, setNewMode] = useState<FactoryMode>(mode)
  const [adoptError, setAdoptError] = useState<string | null>(null)

  const target = parent && name.trim() ? `${parent}/${name.trim()}` : null
  const scaffoldCwd = parent ?? (dir ? parentOf(dir) : '/')

  const startScaffold = (): void => {
    if (!target) return
    scaffold.mutate(
      { dir: target, mode: newMode },
      { onSuccess: () => setConfig.mutate({ dir: target, mode: newMode }) }
    )
  }

  const adoptExisting = async (): Promise<void> => {
    setAdoptError(null)
    const picked = await pick.mutateAsync({ title: 'Choose a Factory server checkout' })
    if (!picked) return
    try {
      const insp = await utils.client.factory.inspect.query({ dir: picked })
      setConfig.mutate({ dir: picked, mode: insp.detectedMode === 'local' ? 'local' : 'platform' })
    } catch (e) {
      setAdoptError(e instanceof Error ? e.message : String(e))
    }
  }

  const check = (ok: boolean, label: string): React.JSX.Element => (
    <div key={label} className="flex items-center gap-1.5 text-[11px]">
      {ok ? (
        <Check size={12} className="shrink-0 text-emerald-500" />
      ) : (
        <X size={12} className="shrink-0 text-muted-foreground" />
      )}
      <span className={ok ? undefined : 'text-muted-foreground'}>{label}</span>
    </div>
  )

  const modeCard = (value: FactoryMode, title: string, desc: string, tip: string) => (
    <Tip content={tip} side="bottom">
      <button
        onClick={() => setNewMode(value)}
        className={cn(
          'flex-1 rounded-md border p-3 text-left cursor-pointer',
          newMode === value ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
        )}
      >
        <div className="text-xs font-medium">{title}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{desc}</div>
      </button>
    </Tip>
  )

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {/* Current checkout */}
      {dir && (
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">Current checkout</span>
            <span
              title={dir}
              className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
            >
              {dir}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Tip content="Stop tracking this checkout (the folder itself is untouched)">
                <Button size="sm" variant="ghost" onClick={() => setConfig.mutate({ dir: null })}>
                  <Unplug size={12} />
                  Disconnect
                </Button>
              </Tip>
            </div>
          </div>
          {inspection && !inspection.dirExists && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
              <AlertTriangle size={13} className="shrink-0" />
              This folder no longer exists — scaffold a new checkout or pick a different folder.
            </div>
          )}
          {inspection?.dirExists && (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
              {check(inspection.scaffolded, 'Scaffolded (package.json with a dev script)')}
              {check(inspection.hasEnv, '.env present')}
              {check(inspection.hasNodeModules, 'Dependencies installed')}
              {check(
                inspection.detectedMode !== 'unknown',
                inspection.detectedMode === 'unknown'
                  ? 'Mode not detected yet'
                  : `Detected mode: ${inspection.detectedMode === 'local' ? 'local self-hosted' : 'platform'}`
              )}
            </div>
          )}
          {inspection?.dirExists && inspection.scaffolded && !inspection.hasNodeModules && (
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="text-[11px] text-muted-foreground">
                node_modules is missing — install dependencies before starting the server.
              </div>
              <div>
                <Tip content="Run `npm install` in the checkout (output streams below)">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={installRunning || install.isPending}
                      onClick={() => install.mutate({ dir })}
                    >
                      <Download size={12} />
                      {installRunning ? 'Installing…' : 'Install dependencies'}
                    </Button>
                  </span>
                </Tip>
              </div>
              {install.error && (
                <div className="text-[11px] text-destructive">{install.error.message}</div>
              )}
            </div>
          )}
          <FactoryTerminal
            id="factory-install"
            cwd={dir}
            running={installRunning}
            className="mt-3 h-48 overflow-hidden rounded-md border border-border"
          />
        </div>
      )}

      {/* Scaffold new */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Hammer size={13} className="text-muted-foreground" />
          Scaffold a new Factory server
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Mastra Factory is an agent-powered software factory: it connects to a GitHub repo, runs a
          kanban pipeline with approval gates, and opens PRs. The Factory server lives in its own
          checkout, separate from the repos its agents work on — pick a standalone folder outside
          your Yardarm projects. The installer is interactive; answer its prompts in the terminal
          below (platform mode prints a browser sign-in link).
        </p>
        <div className="mt-3 flex gap-2">
          {modeCard(
            'platform',
            'Mastra platform',
            'Sign in during setup — hosted Postgres and cloud sandboxes are provisioned for you.',
            'Recommended: the installer signs into the Mastra platform and writes credentials to .env'
          )}
          {modeCard(
            'local',
            'Local self-hosted',
            'Docker Postgres, local sandboxes, manual .env — no Mastra account needed.',
            'Runs `npm create factory@latest -- --no-platform`; you manage the database and .env'
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Tip content="Choose the parent folder the new checkout is created in">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const picked = await pick.mutateAsync({ title: 'Choose a parent folder' })
                if (picked) setParent(picked)
              }}
            >
              <FolderOpen size={12} />
              {parent ? 'Change parent' : 'Choose parent folder'}
            </Button>
          </Tip>
          {parent && (
            <span
              title={parent}
              className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
            >
              {parent}/
            </span>
          )}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="factory-server"
            spellCheck={false}
            className="h-7 w-48 font-mono text-[11px]"
          />
          <Tip
            content={
              target
                ? `Run \`npm create factory@latest\` to create ${target}`
                : 'Choose a parent folder and name first'
            }
          >
            <span className="inline-flex">
              <Button
                size="sm"
                disabled={!target || scaffoldRunning || scaffold.isPending}
                onClick={startScaffold}
              >
                {scaffoldRunning ? 'Scaffolding…' : 'Scaffold'}
              </Button>
            </span>
          </Tip>
        </div>
        {scaffold.error && (
          <div className="mt-2 text-[11px] text-destructive">{scaffold.error.message}</div>
        )}
        <FactoryTerminal
          id="factory-scaffold"
          cwd={scaffoldCwd}
          running={scaffoldRunning}
          className="mt-3 h-72 overflow-hidden rounded-md border border-border"
        />
      </div>

      {/* Use existing */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 text-xs font-medium">
          <FolderOpen size={13} className="text-muted-foreground" />
          Use an existing checkout
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Already scaffolded a Factory server? Point Yardarm at its folder — the setup mode is
          detected from its .env and docker files (you can override it in the header).
        </p>
        <div className="mt-3">
          <Tip content="Pick the folder of an existing Factory server checkout">
            <Button size="sm" variant="outline" onClick={adoptExisting} disabled={pick.isPending}>
              <FolderOpen size={12} />
              Choose folder
            </Button>
          </Tip>
        </div>
        {adoptError && <div className="mt-2 text-[11px] text-destructive">{adoptError}</div>}
      </div>
    </div>
  )
}
