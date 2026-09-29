/**
 * Network layer for the Factory work client. Every request rides the
 * `persist:factory` Electron session — the same partition the dashboard
 * webview signs into — so Yardarm never stores tokens itself. Non-ok
 * responses are classified by `failureFromResponse` (factory-api.ts) and
 * surface as `FactoryApiError`; a stopped server pty short-circuits without
 * touching the network.
 */
import { session } from 'electron'
import type {
  FactoryAttentionKind,
  FactoryAttentionResponse,
  FactoryAttentionView,
  FactoryAuthMe,
  FactoryBoard,
  FactoryDecision,
  FactoryDecisionsResponse,
  FactoryDecisionStatus,
  FactoryExternalSource,
  FactoryIntakeBinding,
  FactoryIntakeFailure,
  FactoryIntakeItem,
  FactoryIntakeSource,
  FactoryProject,
  FactoryWorkItem,
  FactoryWorkItemsResponse
} from '../../../shared/factory-work-types'
import { ptyManager } from '../terminal/pty-manager'
import {
  baseUrlFromEnv,
  FactoryApiError,
  failureFromResponse,
  type StartRunBody,
  type TransitionBody
} from './factory-api'
import { readEnvLines } from './factory-dir'

/** Pty id of the Factory dev server (matches the factory harness router). */
const SERVER_PTY_ID = 'factory-server'
const PARTITION = 'persist:factory'
const TIMEOUT_MS = 8000

/** Base URL of the checkout's Factory server, from its .env PORT. */
export async function resolveFactoryBaseUrl(dir: string): Promise<string> {
  const { lines } = await readEnvLines(dir)
  return baseUrlFromEnv(lines)
}

function looksUnauthenticated(res: Response): boolean {
  return res.status === 401 || res.status === 0 || (res.status >= 300 && res.status < 400)
}

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Fetch against the Factory server using the dashboard webview's session.
 * `credentials: 'include'` should attach the provider cookie; if the first
 * attempt still looks unauthenticated we retry once with the partition's
 * cookies serialized into a manual `Cookie` header (some Electron versions
 * drop localhost cookies from net.fetch).
 */
export async function factoryFetch<T>(dir: string, path: string, init?: RequestInit): Promise<T> {
  if (!ptyManager.exists(SERVER_PTY_ID)) {
    throw new FactoryApiError(0, 'server_stopped', 'The Factory server is not running')
  }
  const ses = session.fromPartition(PARTITION)
  const base = await resolveFactoryBaseUrl(dir)
  const url = `${base}${path}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.body ? { 'Content-Type': 'application/json' } : {})
  }
  let res: Response
  try {
    res = await ses.fetch(url, {
      ...init,
      headers,
      credentials: 'include',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (looksUnauthenticated(res)) {
      const cookies = await ses.cookies.get({ url: base })
      if (cookies.length > 0) {
        res = await ses.fetch(url, {
          ...init,
          headers: { ...headers, Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
          credentials: 'omit',
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
      }
    }
  } catch (err) {
    if (err instanceof FactoryApiError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new FactoryApiError(0, 'unreachable', `Factory server unreachable: ${message}`)
  }
  if (!res.ok) throw failureFromResponse(res.status, await parseJson(res))
  return (await parseJson(res)) as T
}

function post(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) }
}

function put(body: unknown): RequestInit {
  return { method: 'PUT', body: JSON.stringify(body) }
}

const enc = encodeURIComponent

// ---- auth ----

export async function fetchMe(dir: string): Promise<FactoryAuthMe> {
  return factoryFetch<FactoryAuthMe>(dir, '/auth/me')
}

// ---- projects & boards ----

export async function fetchProjects(dir: string): Promise<FactoryProject[]> {
  const res = await factoryFetch<{ projects?: FactoryProject[] }>(dir, '/web/factory/projects')
  return res.projects ?? []
}

export async function createProject(
  dir: string,
  args: { name: string; description?: string }
): Promise<FactoryProject | null> {
  const res = await factoryFetch<{ project?: FactoryProject }>(
    dir,
    '/web/factory/projects',
    post({
      name: args.name.slice(0, 200),
      ...(args.description ? { description: args.description } : {})
    })
  )
  return res.project ?? null
}

export async function fetchBoards(dir: string, projectId: string): Promise<FactoryBoard[]> {
  const res = await factoryFetch<{ boards?: FactoryBoard[] }>(
    dir,
    `/web/factory/projects/${enc(projectId)}/boards`
  )
  return res.boards ?? []
}

// ---- work items ----

export async function fetchWorkItems(
  dir: string,
  projectId: string
): Promise<FactoryWorkItemsResponse> {
  return factoryFetch<FactoryWorkItemsResponse>(
    dir,
    `/web/factory/projects/${enc(projectId)}/work-items`
  )
}

export interface CreateWorkItemArgs {
  title: string
  board?: string
  externalSource?: FactoryExternalSource
  parentWorkItemId?: string
  metadata?: Record<string, unknown>
}

export async function createWorkItem(
  dir: string,
  projectId: string,
  args: CreateWorkItemArgs
): Promise<FactoryWorkItem | null> {
  const res = await factoryFetch<{ workItem?: FactoryWorkItem }>(
    dir,
    `/web/factory/projects/${enc(projectId)}/work-items`,
    post({
      title: args.title.slice(0, 500),
      ...(args.board ? { board: args.board } : {}),
      ...(args.externalSource ? { externalSource: args.externalSource } : {}),
      ...(args.parentWorkItemId ? { parentWorkItemId: args.parentWorkItemId } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {})
    })
  )
  return res.workItem ?? null
}

export async function transitionWorkItem(
  dir: string,
  projectId: string,
  workItemId: string,
  body: TransitionBody
): Promise<FactoryWorkItem | null> {
  const res = await factoryFetch<{ workItem?: FactoryWorkItem }>(
    dir,
    `/web/factory/projects/${enc(projectId)}/work-items/${enc(workItemId)}/transition`,
    post(body)
  )
  return res.workItem ?? null
}

export async function startRun(dir: string, projectId: string, body: StartRunBody): Promise<void> {
  await factoryFetch<unknown>(dir, `/web/factory/projects/${enc(projectId)}/runs/start`, post(body))
}

// ---- decisions ----

export async function fetchDecisions(
  dir: string,
  projectId: string,
  args: { statuses?: FactoryDecisionStatus[]; before?: string; limit?: number }
): Promise<FactoryDecisionsResponse> {
  const params = new URLSearchParams()
  if (args.statuses && args.statuses.length > 0) params.set('statuses', args.statuses.join(','))
  if (args.before) params.set('before', args.before)
  if (args.limit) params.set('limit', String(args.limit))
  const qs = params.size > 0 ? `?${params.toString()}` : ''
  return factoryFetch<FactoryDecisionsResponse>(
    dir,
    `/web/factory/projects/${enc(projectId)}/decisions${qs}`
  )
}

export type FactoryDecisionAction = 'approve' | 'dismiss' | 'retry'

export async function actOnDecision(
  dir: string,
  projectId: string,
  decisionId: string,
  action: FactoryDecisionAction
): Promise<FactoryDecision | null> {
  const res = await factoryFetch<{ decision?: FactoryDecision }>(
    dir,
    `/web/factory/projects/${enc(projectId)}/decisions/${enc(decisionId)}/${action}`,
    post({})
  )
  return res.decision ?? null
}

// ---- attention ----

export async function fetchAttention(
  dir: string,
  projectId: string,
  args: {
    view?: FactoryAttentionView
    kinds?: FactoryAttentionKind[]
    before?: string
    limit?: number
    search?: string
  }
): Promise<FactoryAttentionResponse> {
  const params = new URLSearchParams()
  if (args.view) params.set('view', args.view)
  for (const kind of args.kinds ?? []) params.append('kind', kind)
  if (args.before) params.set('before', args.before)
  if (args.limit) params.set('limit', String(args.limit))
  if (args.search) params.set('search', args.search)
  const qs = params.size > 0 ? `?${params.toString()}` : ''
  return factoryFetch<FactoryAttentionResponse>(
    dir,
    `/web/factory/projects/${enc(projectId)}/attention${qs}`
  )
}

export type FactoryAttentionAction = 'read' | 'archive' | 'restore'

export async function actOnAttention(
  dir: string,
  projectId: string,
  kind: FactoryAttentionKind,
  sourceId: string,
  occurrence: number,
  action: FactoryAttentionAction
): Promise<void> {
  await factoryFetch<unknown>(
    dir,
    `/web/factory/projects/${enc(projectId)}/attention/${enc(kind)}/${enc(sourceId)}/${enc(
      String(occurrence)
    )}/${action}`,
    post({})
  )
}

export async function attentionReadAll(dir: string, projectId: string): Promise<void> {
  await factoryFetch<unknown>(
    dir,
    `/web/factory/projects/${enc(projectId)}/attention/read-all`,
    post({})
  )
}

// ---- intake ----

export async function fetchIntakeItems(
  dir: string,
  cursor?: string
): Promise<{
  items: FactoryIntakeItem[]
  nextCursor: string | null
  failures: FactoryIntakeFailure[]
}> {
  const qs = cursor ? `?cursor=${enc(cursor)}` : ''
  const res = await factoryFetch<{
    items?: FactoryIntakeItem[]
    nextCursor?: string | null
    failures?: FactoryIntakeFailure[]
  }>(dir, `/web/intake/items${qs}`)
  return {
    items: res.items ?? [],
    nextCursor: res.nextCursor ?? null,
    failures: res.failures ?? []
  }
}

export async function fetchIntakeSources(
  dir: string
): Promise<{ sources: FactoryIntakeSource[]; failures: FactoryIntakeFailure[] }> {
  const res = await factoryFetch<{
    sources?: FactoryIntakeSource[]
    failures?: FactoryIntakeFailure[]
  }>(dir, '/web/intake/sources')
  return { sources: res.sources ?? [], failures: res.failures ?? [] }
}

export async function fetchIntakeBindings(dir: string): Promise<FactoryIntakeBinding[]> {
  const res = await factoryFetch<{ bindings?: FactoryIntakeBinding[] }>(dir, '/web/intake/bindings')
  return res.bindings ?? []
}

export async function setIntakeBinding(
  dir: string,
  args: {
    integrationId: string
    sourceId: string
    factoryProjectId: string | null
    board?: string
  }
): Promise<FactoryIntakeBinding[]> {
  const res = await factoryFetch<{ bindings?: FactoryIntakeBinding[] }>(
    dir,
    '/web/intake/bindings',
    put({
      integrationId: args.integrationId,
      sourceId: args.sourceId,
      factoryProjectId: args.factoryProjectId,
      ...(args.board ? { board: args.board } : {})
    })
  )
  return res.bindings ?? []
}
