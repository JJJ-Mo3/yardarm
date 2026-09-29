/**
 * Wire types for the Factory server's `/web/factory/*` + `/web/intake/*` REST
 * API (verified against @mastra/factory 0.17.x dist/routes/contracts).
 *
 * The API is unversioned beta, so these types are deliberately loose: optional
 * fields everywhere the UI can degrade gracefully, and index signatures so
 * shape drift never throws — parse defensively, render what is present.
 */

export interface FactoryAuthUser {
  userId: string
  email?: string | null
  name?: string | null
  avatarUrl?: string | null
  organizationId?: string | null
  [key: string]: unknown
}

/** `GET /auth/me` — the auth + org probe every surface gates on. */
export interface FactoryAuthMe {
  authenticated: boolean
  user?: FactoryAuthUser | null
  provider?: string | null
  [key: string]: unknown
}

export interface FactoryProject {
  id: string
  name: string
  description?: string | null
  defaultModelId?: string | null
  autoRunEnabled?: boolean
  autoApprovePlans?: boolean
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export type FactoryPhaseKind = 'resting' | 'working' | 'terminal'

export interface FactoryBoardTransition {
  outcome: string | null
  to: string
}

export interface FactoryBoardPhase {
  id: string
  title: string
  kind: FactoryPhaseKind
  /** Agent role seated in a `working` phase; absent for resting/terminal. */
  role?: string
  /** Legal outgoing edges — a card's valid drag targets are `transitions.map((t) => t.to)`. */
  transitions: FactoryBoardTransition[]
}

export interface FactoryBoard {
  id: string
  title: string
  initialPhase: string
  phases: FactoryBoardPhase[]
}

export interface FactoryExternalSource {
  /** Present on intake-fed sources; work items created in-app may omit it. */
  integrationId?: string
  type: string
  workspaceId?: string
  externalId: string
  url?: string
  [key: string]: unknown
}

export interface FactoryWorkItemSessionRef {
  sessionId: string
  branch?: string
  threadId?: string
  startedBy?: string
  [key: string]: unknown
}

export interface FactoryWorkItem {
  id: string
  factoryProjectId?: string
  board: string | null
  externalSource?: FactoryExternalSource | null
  parentWorkItemId?: string | null
  title: string
  /** Current stage ids; the authoritative transition path keeps one per item. */
  stages?: string[]
  sessions?: Record<string, FactoryWorkItemSessionRef>
  metadata?: Record<string, unknown> | null
  triageType?: string | null
  commentCount?: number
  revision: number
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface FactoryWorkItemsResponse {
  workItems: FactoryWorkItem[]
  runningSessionIds: string[]
  parkedSessionIds: string[]
}

export const FACTORY_DECISION_STATUSES = [
  'pending',
  'proposed',
  'leased',
  'retry',
  'succeeded',
  'failed',
  'dismissed',
  'superseded'
] as const

export type FactoryDecisionStatus = (typeof FACTORY_DECISION_STATUSES)[number]

export interface FactoryDecision {
  id: string
  workItemId?: string | null
  type?: string
  role?: string
  source?: string
  status: FactoryDecisionStatus
  attempts?: number
  failureCode?: string | null
  canRetry?: boolean
  lastError?: string | null
  createdAt?: string
  updatedAt?: string
  completedAt?: string | null
  [key: string]: unknown
}

export interface FactoryDecisionsResponse {
  decisions: FactoryDecision[]
  nextCursor?: string
}

export const FACTORY_ATTENTION_KINDS = [
  'automation-failed',
  'agent-waiting',
  'automation-proposed',
  'mention',
  'supervisor-finding',
  'activity'
] as const

export type FactoryAttentionKind = (typeof FACTORY_ATTENTION_KINDS)[number]

export type FactoryAttentionView = 'open' | 'unread' | 'archived'

/**
 * One attention inbox row. Every kind carries `key`/`kind`/`occurrence`; the
 * action-identity source id lives in a per-kind field (decisionId, commentId,
 * findingKey, workItemId, sessionId) — see `attentionSourceId`.
 */
export interface FactoryAttentionItem {
  key: string
  kind: FactoryAttentionKind
  occurrence: number
  workItemId?: string | null
  title?: string
  detail?: string
  decisionId?: string
  decisionType?: string
  commentId?: string
  findingKey?: string
  sessionId?: string
  authorName?: string
  occurredAt?: string
  read?: boolean
  archived?: boolean
  target?: Record<string, unknown>
  [key: string]: unknown
}

export interface FactoryAttentionKindSummary {
  open: number
  unread: number
  latest: { key: string; at: string; unread: boolean } | null
}

export interface FactoryAttentionResponse {
  items: FactoryAttentionItem[]
  kinds: Partial<Record<FactoryAttentionKind, FactoryAttentionKindSummary>>
  hasMore: boolean
  nextCursor?: string
}

export interface FactoryIntakeItem {
  integrationId: string
  sourceId?: string
  title: string
  status?: string
  labels?: string[]
  assignee?: string | null
  createdAt?: string
  updatedAt?: string
  externalSource: FactoryExternalSource
  [key: string]: unknown
}

export interface FactoryIntakeSource {
  integrationId: string
  id: string
  name: string
  type?: string
  [key: string]: unknown
}

export interface FactoryIntakeBinding {
  integrationId: string
  sourceId: string
  factoryProjectId: string | null
  board?: string | null
  [key: string]: unknown
}

/** Per-integration failure entry returned alongside intake sources/items. */
export interface FactoryIntakeFailure {
  integrationId: string
  [key: string]: unknown
}
