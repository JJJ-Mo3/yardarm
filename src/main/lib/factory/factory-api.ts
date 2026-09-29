/**
 * Pure helpers for the Factory work client: base-URL resolution from the
 * checkout's .env, HTTP failure classification, board-graph queries, and the
 * idempotent request-body builders (requestId / sessionId / kickoffKey are
 * generated here, main-side, so the renderer never mints identity fields).
 *
 * Everything in this module is Electron-free and unit-tested; the network
 * layer that rides the `persist:factory` webview session lives in
 * factory-client.ts.
 */
import { randomUUID } from 'node:crypto'
import type {
  FactoryAttentionItem,
  FactoryBoard,
  FactoryWorkItem
} from '../../../shared/factory-work-types'
import { getEnv, type EnvLine } from './env-file'

export const DEFAULT_FACTORY_PORT = 4111

/**
 * Failure taxonomy: `server_stopped` (Factory pty not running), `unreachable`
 * (network/timeout), `auth_required` (401 or a sign-in redirect), or the
 * server's own error code passed through (`stale`, `organization_required`,
 * `governed_transition_required`, `decision_not_retryable`, ...).
 */
export class FactoryApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.name = 'FactoryApiError'
    this.status = status
    this.code = code
  }
}

/** `http://localhost:<PORT>` from the checkout's .env (last-wins), default 4111. */
export function baseUrlFromEnv(lines: EnvLine[]): string {
  const raw = getEnv(lines, 'PORT')?.trim() ?? ''
  const port = Number.parseInt(raw, 10)
  return `http://localhost:${Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_FACTORY_PORT}`
}

/**
 * Classify a non-ok response. 401s and redirects (the auth gate bounces
 * navigations to /signin; `redirect: 'manual'` surfaces them as 3xx or an
 * opaqueredirect with status 0) mean "sign in first"; everything else passes
 * the server's `{ error, message? }` JSON through as the code.
 */
export function failureFromResponse(status: number, body: unknown): FactoryApiError {
  if (status === 401 || status === 0 || (status >= 300 && status < 400)) {
    return new FactoryApiError(
      status,
      'auth_required',
      'Sign in to the Factory dashboard to use the work board'
    )
  }
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const code = typeof obj.error === 'string' && obj.error ? obj.error : `http_${status}`
  const message = typeof obj.message === 'string' && obj.message ? obj.message : code
  return new FactoryApiError(status, code, message)
}

/** Legal drag targets out of `phaseId` — the phase's declared transition edges. */
export function allowedTransitionTargets(board: FactoryBoard, phaseId: string): string[] {
  const phase = board.phases.find((p) => p.id === phaseId)
  if (!phase) return []
  return [...new Set(phase.transitions.map((t) => t.to))]
}

/** The item's current phase on `board`, or null when none of its stages match. */
export function currentBoardStage(item: FactoryWorkItem, board: FactoryBoard): string | null {
  const phaseIds = new Set(board.phases.map((p) => p.id))
  for (const stage of item.stages ?? []) {
    if (phaseIds.has(stage)) return stage
  }
  return null
}

export interface TransitionBody {
  board: string
  stage: string
  expectedRevision: number
  requestId: string
  cause: string
  reenter?: true
}

export function buildTransitionBody(args: {
  board: string
  stage: string
  expectedRevision: number
  cause?: string
  reenter?: boolean
}): TransitionBody {
  return {
    board: args.board,
    stage: args.stage,
    expectedRevision: args.expectedRevision,
    requestId: randomUUID(),
    cause: (args.cause ?? 'yardarm-board-drag').slice(0, 256),
    ...(args.reenter ? { reenter: true as const } : {})
  }
}

export interface StartRunBody {
  sessionId: string
  threadTitle: string
  kickoffKey: string
  workItem: {
    id: string
    role: string
    input: {
      title: string
      board?: string
      externalSource?: FactoryWorkItem['externalSource']
      parentWorkItemId?: string | null
      metadata?: Record<string, unknown> | null
    }
  }
}

/**
 * Body for `POST .../runs/start`. The `input` echoes the existing card's
 * create-shape (the server reuses it when the card id matches); sessionId and
 * kickoffKey are fresh idempotency uuids per start gesture.
 */
export function buildStartRunBody(item: FactoryWorkItem, role: string): StartRunBody {
  return {
    sessionId: randomUUID(),
    threadTitle: item.title.slice(0, 512),
    kickoffKey: randomUUID(),
    workItem: {
      id: item.id,
      role: role.slice(0, 32),
      input: {
        title: item.title.slice(0, 500),
        ...(item.board ? { board: item.board } : {}),
        ...(item.externalSource ? { externalSource: item.externalSource } : {}),
        ...(item.parentWorkItemId ? { parentWorkItemId: item.parentWorkItemId } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {})
      }
    }
  }
}

/**
 * The per-kind source id for attention receipt actions
 * (`POST .../attention/:kind/:sourceId/:occurrence/...`). Echo the item's own
 * field verbatim — the identity scheme is the server's, not ours.
 */
export function attentionSourceId(item: FactoryAttentionItem): string | null {
  switch (item.kind) {
    case 'automation-failed':
    case 'automation-proposed':
      return item.decisionId ?? null
    case 'mention':
      return item.commentId ?? null
    case 'activity':
      return item.workItemId ?? null
    case 'supervisor-finding':
      return item.findingKey ?? null
    case 'agent-waiting':
      return item.sessionId ?? null
    default:
      return null
  }
}
