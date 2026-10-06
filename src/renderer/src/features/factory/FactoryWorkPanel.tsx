/**
 * Work section of the Factory tab — the native client for a running Factory
 * server's board APIs. Gates in order: server running → signed in (via the
 * Server section's dashboard webview, whose `persist:factory` session the
 * main process reuses) → account has an organization → project picker +
 * Board / Decisions / Attention / Intake sub-tabs.
 */
import React, { useState } from 'react'
import { Loader2, LogIn, Play, Plus, ServerOff, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Tip } from '../../components/ui/tooltip'
import { FactoryAttention } from './FactoryAttention'
import { FactoryDecisions } from './FactoryDecisions'
import { FactoryIntake } from './FactoryIntake'
import { FactoryWorkBoard } from './FactoryWorkBoard'

const PROJECT_STORAGE_KEY = 'factory-work-project'

type SubTab = 'board' | 'decisions' | 'attention' | 'intake'

/** Extract the `[code]` prefix the factoryWork router puts on API errors. */
export function factoryErrorCode(message: string | undefined): string | null {
  if (!message) return null
  const m = /^\[([a-z0-9_]+)\]/.exec(message)
  return m ? m[1] : null
}

function Gate({
  icon,
  title,
  body,
  action
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <span className="text-muted-foreground">{icon}</span>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
        {action}
      </div>
    </div>
  )
}

export function FactoryWorkPanel({
  dir,
  active,
  serverRunning,
  onShowServer,
  onShowChecklist
}: {
  dir: string
  active: boolean
  serverRunning: boolean
  onShowServer: () => void
  onShowChecklist: () => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const me = trpc.factoryWork.me.useQuery(
    { dir },
    {
      enabled: active && serverRunning,
      refetchInterval: active && serverRunning ? 10_000 : false,
      retry: false
    }
  )
  const meCode = factoryErrorCode(me.error?.message)
  // When the API errors, check whether the server is even serving its web app
  // (the SPA-not-mounted failure mode answers `/` with the bare Hono default).
  const probe = trpc.factory.dashboardProbe.useQuery(
    { dir },
    { enabled: active && serverRunning && !!me.error, retry: false }
  )
  const authed = !!me.data?.authenticated
  const hasOrg = !!me.data?.user?.organizationId
  const ready = serverRunning && authed && hasOrg && meCode === null

  const projects = trpc.factoryWork.projects.useQuery(
    { dir },
    { enabled: active && ready, refetchInterval: active && ready ? 30_000 : false, retry: false }
  )
  const projectsCode = factoryErrorCode(projects.error?.message)

  const [storedProject, setStoredProject] = useState<string | null>(() =>
    localStorage.getItem(PROJECT_STORAGE_KEY)
  )
  const [subTab, setSubTab] = useState<SubTab>('board')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const selectProject = (id: string): void => {
    setStoredProject(id)
    localStorage.setItem(PROJECT_STORAGE_KEY, id)
  }
  const createProject = trpc.factoryWork.createProject.useMutation({
    onSuccess: (project) => {
      setCreating(false)
      setNewName('')
      void utils.factoryWork.projects.invalidate()
      if (project?.id) selectProject(project.id)
    }
  })
  const serverStart = trpc.factory.serverStart.useMutation({
    onSuccess: () => utils.factory.status.invalidate()
  })

  if (!serverRunning) {
    return (
      <Gate
        icon={<ServerOff size={20} />}
        title="Factory server not running"
        body="The work board talks to your Factory server's API. Start the server, then come back here."
        action={
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Tip content="Run `npm run dev` in the checkout right here">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    disabled={serverStart.isPending}
                    onClick={() => serverStart.mutate({ dir })}
                  >
                    {serverStart.isPending ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Play size={12} />
                    )}
                    Start server
                  </Button>
                </span>
              </Tip>
              <Tip content="Go to the Server tab — dashboard, logs, and URL chips live there">
                <Button size="sm" variant="outline" onClick={onShowServer}>
                  Go to Server
                </Button>
              </Tip>
            </div>
            {serverStart.error && (
              <div className="text-[11px] text-destructive">{serverStart.error.message}</div>
            )}
          </div>
        }
      />
    )
  }

  if (meCode === 'auth_required' || (me.data && !authed)) {
    return (
      <Gate
        icon={<LogIn size={20} />}
        title="Sign in to Factory"
        body="Sign in once via the Server tab's dashboard — Yardarm reuses that session for the work board. Signing out there signs this out too."
        action={
          <Tip content="Open the Server tab's embedded dashboard to sign in">
            <Button size="sm" variant="outline" onClick={onShowServer}>
              Open dashboard
            </Button>
          </Tip>
        }
      />
    )
  }

  if ((me.data && authed && !hasOrg) || meCode === 'organization_required') {
    return (
      <Gate
        icon={<LogIn size={20} />}
        title="Organization required"
        body="Factory's board APIs are organization-scoped. This account has no organization yet — create or join one from the Factory dashboard, or self-host auth with WorkOS (see the checklist's sign-in step). A purely local no-auth server can't serve the board."
        action={
          <Tip content="Open the guided setup checklist — its sign-in step covers both auth paths">
            <Button size="sm" variant="outline" onClick={onShowChecklist}>
              Open checklist
            </Button>
          </Tip>
        }
      />
    )
  }

  if (me.error && (meCode === 'http_404' || probe.data?.state === 'bare_api')) {
    return (
      <Gate
        icon={<ServerOff size={20} />}
        title="Factory server isn't serving its web app"
        body="The server is running but its dashboard/API routes aren't mounted — usually the dashboard UI bundle wasn't found at startup. The checklist's 'Dashboard UI configured' step can fix .env and restart the server."
        action={
          <Tip content="Open the guided setup checklist to fix the dashboard UI configuration">
            <Button size="sm" variant="outline" onClick={onShowChecklist}>
              Open checklist
            </Button>
          </Tip>
        }
      />
    )
  }

  if (me.error) {
    return (
      <Gate
        icon={<ServerOff size={20} />}
        title="Can't reach the Factory server"
        body={me.error.message}
        action={
          <Tip content="Open the guided setup checklist — it diagnoses each step from scaffold to a working board">
            <Button size="sm" variant="outline" onClick={onShowChecklist}>
              Open checklist
            </Button>
          </Tip>
        }
      />
    )
  }

  if (!me.data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Checking Factory session…
      </div>
    )
  }

  const projectList = projects.data ?? []
  const projectId =
    storedProject && projectList.some((p) => p.id === storedProject)
      ? storedProject
      : (projectList[0]?.id ?? null)

  const createForm = (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        placeholder="Project name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && newName.trim() && !createProject.isPending) {
            createProject.mutate({ dir, name: newName.trim() })
          }
        }}
        className="h-6 w-48 text-[11px]"
      />
      <Tip content="Create this Factory project">
        <span className="inline-flex">
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={!newName.trim() || createProject.isPending}
            onClick={() => createProject.mutate({ dir, name: newName.trim() })}
          >
            Create
          </Button>
        </span>
      </Tip>
      <Tip content="Cancel creating a project">
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setCreating(false)}>
          <X size={12} />
        </Button>
      </Tip>
    </div>
  )

  if (projectList.length === 0) {
    return (
      <Gate
        icon={<Plus size={20} />}
        title={projectsCode ? 'Projects unavailable' : 'No Factory projects yet'}
        body={
          projectsCode
            ? (projects.error?.message ?? 'Could not load projects')
            : 'Create a project to get a board, work items, and agent runs.'
        }
        action={
          projectsCode ? undefined : creating ? (
            createForm
          ) : (
            <Tip content="Create your first Factory project">
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <Plus size={13} />
                New project
              </Button>
            </Tip>
          )
        }
      />
    )
  }

  const subTabBtn = (id: SubTab, label: string, tip: string): React.JSX.Element => (
    <Tip key={id} content={tip} side="bottom">
      <button
        onClick={() => setSubTab(id)}
        className={cn(
          'rounded-md px-2.5 py-1 text-xs cursor-pointer',
          subTab === id ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {label}
      </button>
    </Tip>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Select value={projectId ?? ''} onValueChange={selectProject}>
          <Tip content="Which Factory project's board and inboxes to show" side="bottom">
            <SelectTrigger className="h-6 max-w-56 text-[11px]">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
          </Tip>
          <SelectContent>
            {projectList.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {creating ? (
          createForm
        ) : (
          <Tip content="Create another Factory project">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setCreating(true)}
            >
              <Plus size={13} />
            </Button>
          </Tip>
        )}
        {createProject.error && (
          <span className="truncate text-[11px] text-destructive">
            {createProject.error.message}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {subTabBtn('board', 'Board', 'Kanban of this project’s work items across board phases')}
          {subTabBtn('decisions', 'Decisions', 'Approve, dismiss, or retry automation decisions')}
          {subTabBtn('attention', 'Attention', 'Mentions, failures, and waiting agents')}
          {subTabBtn('intake', 'Intake', 'External issues (GitHub, Linear, …) and board bindings')}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {projectId && subTab === 'board' && (
          <FactoryWorkBoard dir={dir} projectId={projectId} active={active} />
        )}
        {projectId && subTab === 'decisions' && (
          <FactoryDecisions dir={dir} projectId={projectId} active={active} />
        )}
        {projectId && subTab === 'attention' && (
          <FactoryAttention dir={dir} projectId={projectId} active={active} />
        )}
        {projectId && subTab === 'intake' && (
          <FactoryIntake dir={dir} projectId={projectId} active={active} />
        )}
      </div>
    </div>
  )
}
