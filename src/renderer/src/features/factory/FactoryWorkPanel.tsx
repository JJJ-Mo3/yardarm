/**
 * Work section of the Factory tab — the native client for a running Factory
 * server's board APIs. Gates in order: server running → signed in (via the
 * Server section's dashboard webview, whose `persist:factory` session the
 * main process reuses) → account has an organization → project picker +
 * Board / Decisions / Attention / Intake sub-tabs.
 */
import React, { useState } from 'react'
import { LogIn, Plus, ServerOff, X } from 'lucide-react'
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
import { FactoryDecisions } from './FactoryDecisions'
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
  onShowServer
}: {
  dir: string
  active: boolean
  serverRunning: boolean
  onShowServer: () => void
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

  if (!serverRunning) {
    return (
      <Gate
        icon={<ServerOff size={20} />}
        title="Factory server not running"
        body="The work board talks to your Factory server's API. Start the server first, then come back here."
        action={
          <Tip content="Go to the Server section and start the Factory server">
            <Button size="sm" variant="outline" onClick={onShowServer}>
              Go to Server
            </Button>
          </Tip>
        }
      />
    )
  }

  if (meCode === 'auth_required' || (me.data && !authed)) {
    return (
      <Gate
        icon={<LogIn size={20} />}
        title="Sign in to Factory"
        body="Sign in once via the Server section's dashboard — Yardarm reuses that session for the work board. Signing out there signs this out too."
        action={
          <Tip content="Open the Server section's embedded dashboard to sign in">
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
        body="Factory's board APIs are organization-scoped. This account has no organization yet — create or join one from the Factory dashboard. A purely local no-auth server can't serve the board."
      />
    )
  }

  if (me.error) {
    return (
      <Gate
        icon={<ServerOff size={20} />}
        title="Can't reach the Factory server"
        body={me.error.message}
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
        {(subTab === 'attention' || subTab === 'intake') && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Coming soon
          </div>
        )}
      </div>
    </div>
  )
}
