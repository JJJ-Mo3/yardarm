/**
 * Guided setup checklist for the Factory tab — every step from scaffold to a
 * working board, each with live status and either a one-click fix or a jump
 * to the section where the fix lives. Statuses are pure derivations over the
 * same tRPC queries the other sections use (react-query dedupes by key), so
 * the checklist owns no state of its own beyond its mutations.
 */
import React from 'react'
import { AlertTriangle, CheckCircle2, Circle, CircleSlash, Loader2, XCircle } from 'lucide-react'
import type { FactoryMode } from '@shared/ipc-types'
import { SEED_PROVIDER_ENV_VARS } from '@shared/provider-key-env'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import type { FactoryInspection } from './FactoryView'
import { factoryErrorCode } from './FactoryWorkPanel'

type StepStatus = 'done' | 'todo' | 'fail' | 'blocked' | 'checking' | 'skipped'

const STATUS_ICON: Record<StepStatus, React.JSX.Element> = {
  done: <CheckCircle2 size={15} className="text-emerald-500" />,
  todo: <Circle size={15} className="text-muted-foreground/60" />,
  fail: <XCircle size={15} className="text-destructive" />,
  blocked: <CircleSlash size={15} className="text-muted-foreground/40" />,
  checking: <Loader2 size={15} className="animate-spin text-muted-foreground" />,
  skipped: <CircleSlash size={15} className="text-muted-foreground/40" />
}

const PROVIDER_KEY_VARS = new Set(Object.values(SEED_PROVIDER_ENV_VARS))

function Step({
  status,
  title,
  detail,
  warning,
  error,
  actions
}: {
  status: StepStatus
  title: string
  detail: string
  warning?: string | null
  error?: string | null
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex gap-3 rounded-lg border border-border p-3">
      <span className="mt-0.5 shrink-0">{STATUS_ICON[status]}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-xs font-medium">
          {title}
          {status === 'skipped' && (
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
              not needed for this checkout
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">{detail}</div>
        {warning && (
          <div className="flex items-start gap-1 text-[11px] text-amber-500">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            {warning}
          </div>
        )}
        {error && <div className="text-[11px] text-destructive">{error}</div>}
        {actions && <div className="mt-1 flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  )
}

function ActionButton({
  label,
  tip,
  disabled,
  pending,
  onClick,
  variant = 'outline'
}: {
  label: string
  tip: string
  disabled?: boolean
  pending?: boolean
  onClick: () => void
  variant?: 'outline' | 'default'
}): React.JSX.Element {
  return (
    <Tip content={tip}>
      <span className="inline-flex">
        <Button
          size="sm"
          variant={variant}
          className="h-6 px-2 text-[11px]"
          disabled={disabled || pending}
          onClick={onClick}
        >
          {pending && <Loader2 size={11} className="animate-spin" />}
          {label}
        </Button>
      </span>
    </Tip>
  )
}

export function FactoryChecklist({
  dir,
  mode,
  active,
  inspection,
  serverRunning,
  installRunning,
  dbRunning,
  onGoTo
}: {
  dir: string
  mode: FactoryMode
  active: boolean
  inspection: FactoryInspection | null
  serverRunning: boolean
  installRunning: boolean
  dbRunning: boolean
  onGoTo: (section: 'setup' | 'env' | 'run' | 'work') => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const scaffolded = !!inspection?.scaffolded
  const localish = mode === 'local' || !!inspection?.hasDockerCompose || !!inspection?.hasDbScript

  const envRead = trpc.factory.envRead.useQuery({ dir, mode }, { enabled: active })
  const docker = trpc.factory.dockerStatus.useQuery(undefined, {
    enabled: active && localish,
    refetchInterval: active && localish ? 5000 : false
  })
  const dbCheck = trpc.factory.dbReachable.useQuery(
    { dir },
    { enabled: active && localish && scaffolded, refetchInterval: 5000 }
  )
  const uiDist = trpc.factory.uiDist.useQuery({ dir }, { enabled: active })
  const probe = trpc.factory.dashboardProbe.useQuery(
    { dir },
    { enabled: active && serverRunning, refetchInterval: active && serverRunning ? 5000 : false }
  )
  const probeState = serverRunning ? probe.data?.state : undefined
  const me = trpc.factoryWork.me.useQuery(
    { dir },
    {
      enabled: active && serverRunning && (probeState === 'spa' || probeState === 'unknown'),
      refetchInterval: 10_000,
      retry: false
    }
  )

  const invalidateEnv = (): void => {
    utils.factory.envRead.invalidate()
    utils.factory.inspect.invalidate()
    utils.factory.uiDist.invalidate()
  }
  const install = trpc.factory.install.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })
  const dockerStart = trpc.factory.dockerStartRuntime.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })
  const dbUp = trpc.factory.dbUp.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })
  const genKey = trpc.factory.envGenerateEncryptionKey.useMutation({ onSuccess: invalidateEnv })
  const seedKeys = trpc.factory.envSeedProviderKeys.useMutation({ onSuccess: invalidateEnv })
  const seedDefaults = trpc.factory.envSeedExampleDefaults.useMutation({ onSuccess: invalidateEnv })
  const fixUiDist = trpc.factory.fixUiDist.useMutation({ onSuccess: invalidateEnv })
  const serverStart = trpc.factory.serverStart.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })
  const serverRestart = trpc.factory.serverRestart.useMutation({
    onSuccess: () => {
      utils.factory.status.invalidate()
      utils.factory.dashboardProbe.invalidate()
      utils.factory.uiDist.invalidate()
    }
  })
  // Combined bare-API remediation: install/point at the dashboard bundle,
  // then restart (env is boot-only, and the restart verifies the old process
  // actually released its port instead of lingering with the stale env).
  const fixAndRestart = async (): Promise<void> => {
    try {
      await fixUiDist.mutateAsync({ dir })
      await serverRestart.mutateAsync({ dir })
    } catch {
      // Surfaced via fixUiDist.error / serverRestart.error on the steps.
    }
  }

  const env: Record<string, string> = {}
  for (const e of envRead.data?.entries ?? []) env[e.key] = e.value
  const missing = envRead.data?.missingRequired ?? inspection?.missingRequired ?? []
  const hasProviderKey = Object.entries(env).some(
    ([key, value]) => PROVIDER_KEY_VARS.has(key) && value.trim() !== ''
  )
  const authDisabledValue = (env.MASTRACODE_AUTH_DISABLED ?? '').trim()
  const authDisabled =
    authDisabledValue !== '' && authDisabledValue !== '0' && authDisabledValue !== 'false'

  // ---- step statuses ----

  const checkoutDone = !!inspection?.dirExists && scaffolded
  const checkoutStatus: StepStatus = !inspection ? 'checking' : checkoutDone ? 'done' : 'todo'

  const installDone = !!inspection?.hasNodeModules
  const installStatus: StepStatus = !checkoutDone
    ? 'blocked'
    : installRunning
      ? 'checking'
      : installDone
        ? 'done'
        : 'todo'

  const daemonUp = !!docker.data?.daemonRunning
  const dbReachable = !dbCheck.data?.checked || !!dbCheck.data?.reachable
  const dbStatus: StepStatus = !localish
    ? 'skipped'
    : !checkoutDone
      ? 'blocked'
      : dbRunning || docker.isLoading || dbCheck.isLoading
        ? 'checking'
        : !daemonUp
          ? 'fail'
          : dbReachable
            ? 'done'
            : 'todo'

  const envDone = missing.length === 0 && hasProviderKey
  const envStatus: StepStatus = !checkoutDone
    ? 'blocked'
    : envRead.isLoading
      ? 'checking'
      : envDone
        ? 'done'
        : 'todo'
  const envDetailParts: string[] = []
  if (missing.length > 0) envDetailParts.push(`Missing required keys: ${missing.join(', ')}.`)
  if (!hasProviderKey) {
    envDetailParts.push(
      'No model-provider API key found (e.g. ANTHROPIC_API_KEY / OPENAI_API_KEY) — agents need at least one to run.'
    )
  }

  const uiDistStatus: StepStatus = !checkoutDone
    ? 'blocked'
    : uiDist.isLoading
      ? 'checking'
      : uiDist.data?.servable
        ? 'done'
        : uiDist.data?.fixAvailable
          ? 'todo'
          : 'blocked'

  const serverStatus: StepStatus = !checkoutDone ? 'blocked' : serverRunning ? 'done' : 'todo'
  const startBlocked = !scaffolded
    ? 'Scaffold the checkout first (Setup section)'
    : missing.length > 0
      ? `Set the required .env keys first: ${missing.join(', ')}`
      : null

  const dashboardStatus: StepStatus = !serverRunning
    ? 'blocked'
    : probeState === 'spa'
      ? 'done'
      : probeState === 'bare_api'
        ? 'fail'
        : 'checking'

  const meCode = factoryErrorCode(me.error?.message)
  const authed = !!me.data?.authenticated
  const hasOrg = !!me.data?.user?.organizationId
  const signinStatus: StepStatus =
    !serverRunning || dashboardStatus === 'fail'
      ? 'blocked'
      : authed && hasOrg
        ? 'done'
        : (authed && me.data && !hasOrg) || meCode === 'organization_required'
          ? 'fail'
          : me.isLoading || (!me.data && !me.error)
            ? 'checking'
            : 'todo'

  // Restart applies an already-in-place dashboard to a still-running server
  // (env and the public/factory copy are only picked up at boot).
  const restartAction = serverRunning && uiDist.data?.servable && probeState === 'bare_api' && (
    <ActionButton
      label="Restart server"
      tip="Restart the Factory server so it picks up the dashboard bundle — the restart verifies the old process actually released its port"
      pending={serverRestart.isPending}
      onClick={() => serverRestart.mutate({ dir })}
      variant="default"
    />
  )
  const fixAction = uiDist.data?.fixAvailable && (
    <ActionButton
      label={serverRunning ? 'Fix dashboard & restart' : 'Fix dashboard'}
      tip="Point .env at the bundled dashboard (node_modules/mastra/dist/factory), copy it into src/mastra/public/factory, and restart the server if it is running"
      pending={fixUiDist.isPending || serverRestart.isPending}
      onClick={() => {
        if (serverRunning) void fixAndRestart()
        else fixUiDist.mutate({ dir })
      }}
      variant="default"
    />
  )

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 p-4">
      <div className="text-sm font-medium">Setup checklist</div>
      <div className="mb-1 text-[11px] text-muted-foreground">
        Everything a Factory needs, from an empty folder to a working board. Each step checks itself
        live — fix it here or jump to the section that owns it.
      </div>

      <Step
        status={checkoutStatus}
        title="Factory checkout scaffolded"
        detail="A Factory server checkout (npm create factory@latest) with a dev script. Scaffold a new one or point Yardarm at an existing checkout in the Setup section."
        actions={
          !checkoutDone && (
            <ActionButton
              label="Go to Setup"
              tip="Open the Setup section to scaffold or select a Factory checkout"
              onClick={() => onGoTo('setup')}
            />
          )
        }
      />

      <Step
        status={installStatus}
        title="Dependencies installed"
        detail={
          installRunning
            ? 'npm install is running — its output is in the Setup section.'
            : 'node_modules must exist: the server runs from it, and the dashboard UI ships inside the mastra CLI package there.'
        }
        error={install.error?.message}
        actions={
          installStatus === 'todo' && (
            <ActionButton
              label="Install dependencies"
              tip="Run npm install in the checkout (output appears in the Setup section)"
              pending={install.isPending}
              onClick={() => {
                install.mutate({ dir })
                onGoTo('setup')
              }}
            />
          )
        }
      />

      <Step
        status={dbStatus}
        title="Database running"
        detail={
          !localish
            ? 'Platform-hosted checkouts use Mastra-managed Postgres — nothing to run locally.'
            : !daemonUp && !docker.isLoading
              ? 'Docker is not running — the local Postgres container needs it.'
              : dbCheck.data?.checked && !dbReachable
                ? `Nothing is listening on ${dbCheck.data.host}:${dbCheck.data.port} (this checkout's DATABASE_URL) — start the database container.`
                : 'The local Postgres container from docker-compose, reachable at the .env DATABASE_URL.'
        }
        error={dockerStart.error?.message ?? dbUp.error?.message}
        actions={
          <>
            {dbStatus === 'fail' && docker.data?.runtime && (
              <ActionButton
                label={`Start ${docker.data.runtime.label}`}
                tip="Bring the Docker daemon up (output appears in the Environment section's database card)"
                pending={dockerStart.isPending}
                onClick={() => dockerStart.mutate({ dir })}
              />
            )}
            {dbStatus === 'todo' && (
              <ActionButton
                label="Start database"
                tip="Run npm run db:up in the checkout (output appears in the Environment section's database card)"
                pending={dbUp.isPending}
                onClick={() => dbUp.mutate({ dir })}
              />
            )}
            {(dbStatus === 'fail' || dbStatus === 'todo') && (
              <ActionButton
                label="Open Environment"
                tip="Open the Environment section — the database card and its terminal live there"
                onClick={() => onGoTo('env')}
              />
            )}
          </>
        }
      />

      <Step
        status={envStatus}
        title="Environment configured"
        detail={
          envDetailParts.length > 0
            ? envDetailParts.join(' ')
            : 'Required .env keys are set and a model-provider API key is present.'
        }
        error={genKey.error?.message ?? seedKeys.error?.message ?? seedDefaults.error?.message}
        actions={
          envStatus === 'todo' && (
            <>
              {missing.includes('FACTORY_CREDENTIAL_ENCRYPTION_KEY') && (
                <ActionButton
                  label="Generate encryption key"
                  tip="Generate a random FACTORY_CREDENTIAL_ENCRYPTION_KEY and write it to .env"
                  pending={genKey.isPending}
                  onClick={() => genKey.mutate({ dir })}
                />
              )}
              {!hasProviderKey && (
                <ActionButton
                  label="Seed provider keys"
                  tip="Copy the model-provider API keys Yardarm already uses into the checkout's .env"
                  pending={seedKeys.isPending}
                  onClick={() => seedKeys.mutate({ dir })}
                />
              )}
              <ActionButton
                label="Seed defaults"
                tip="Copy .env.example's defaults (plus the docker-compose DATABASE_URL) into absent .env keys"
                pending={seedDefaults.isPending}
                onClick={() => seedDefaults.mutate({ dir })}
              />
              <ActionButton
                label="Open Environment"
                tip="Open the Environment section to edit .env by hand"
                onClick={() => onGoTo('env')}
              />
            </>
          )
        }
      />

      <Step
        status={uiDistStatus}
        title="Dashboard UI configured"
        detail={
          uiDist.data?.servable
            ? 'A dashboard build is in place — MASTRACODE_UI_DIST points at one and/or a copy lives at src/mastra/public/factory, where the server finds it with no configuration.'
            : uiDist.data?.fixAvailable
              ? "Without a dashboard build in a known place the server falls back to its bare API and the dashboard never loads ('Welcome to the Mastra API'). Yardarm can point .env at the bundle inside the mastra CLI and copy it to src/mastra/public/factory."
              : checkoutDone && uiDist.data && !uiDist.data.fixAvailable
                ? 'No dashboard build found — install dependencies first (the bundle ships inside node_modules/mastra).'
                : 'Checks that the server has a dashboard build to serve at its root URL.'
        }
        error={fixUiDist.error?.message}
        actions={
          <>
            {uiDistStatus === 'todo' && fixAction}
            {uiDistStatus === 'done' && restartAction}
          </>
        }
      />

      <Step
        status={serverStatus}
        title="Server running"
        detail="npm run dev in the checkout — the Server section embeds its dashboard and logs."
        error={serverStart.error?.message}
        actions={
          serverStatus === 'todo' && (
            <>
              <ActionButton
                label="Start server"
                tip={startBlocked ?? 'Run npm run dev in the checkout'}
                disabled={!!startBlocked}
                pending={serverStart.isPending}
                onClick={() => serverStart.mutate({ dir })}
              />
              <ActionButton
                label="Go to Server"
                tip="Open the Server section — dashboard, logs, and URL chips live there"
                onClick={() => onGoTo('run')}
              />
            </>
          )
        }
      />

      <Step
        status={dashboardStatus}
        title="Dashboard is serving"
        detail={
          !serverRunning
            ? 'Start the server first — then Yardarm probes its root URL.'
            : probeState === 'spa'
              ? 'The server answers with the Factory dashboard.'
              : probeState === 'bare_api'
                ? "The server is only serving its bare API ('Welcome to the Mastra API') — the dashboard isn't mounted. Fix the dashboard, then restart: the restart also cleans up leaked server processes still holding the port with the old environment."
                : 'Probing the server root — still starting, or serving something unexpected.'
        }
        error={serverRestart.error?.message}
        actions={dashboardStatus === 'fail' && (fixAction || restartAction)}
      />

      <Step
        status={signinStatus}
        title="Signed in with an organization"
        detail="Default servers use Mastra platform sign-in inside the dashboard itself (Server section) — Yardarm reuses that session for the work board. Self-hosters can switch to WorkOS by setting WORKOS_API_KEY and WORKOS_CLIENT_ID in .env (a personal organization is bootstrapped automatically). MASTRACODE_AUTH_DISABLED can never enable the board — its APIs are organization-scoped and reject anonymous access."
        warning={
          authDisabled
            ? 'MASTRACODE_AUTH_DISABLED is set in .env — remove it (Environment section) or the work board can never load.'
            : signinStatus === 'fail'
              ? 'This account has no organization — create or join one from the Factory dashboard.'
              : null
        }
        actions={
          <>
            {signinStatus === 'todo' && (
              <ActionButton
                label="Open dashboard to sign in"
                tip="Open the Server section's embedded dashboard and sign in there — the work board reuses that session"
                onClick={() => onGoTo('run')}
              />
            )}
            {authDisabled && (
              <ActionButton
                label="Open Environment"
                tip="Open the Environment section to remove MASTRACODE_AUTH_DISABLED from .env"
                onClick={() => onGoTo('env')}
              />
            )}
            {signinStatus === 'done' && (
              <ActionButton
                label="Open work board"
                tip="Everything is ready — open the Work section"
                onClick={() => onGoTo('work')}
                variant="default"
              />
            )}
          </>
        }
      />
    </div>
  )
}
