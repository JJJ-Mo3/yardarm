/**
 * UI message model shared between main process and renderer.
 * Messages are stored in SQLite as arrays of MessagePart and streamed
 * to the renderer as AgentUIEvent chunks (whole-message upserts).
 */

export type Mode = 'build' | 'plan' | 'fast'
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

export interface TextPart {
  type: 'text'
  text: string
}

export interface ReasoningPart {
  type: 'reasoning'
  text: string
}

export interface ToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  /** JSON-serializable tool arguments (may be partial while streaming) */
  args: unknown
  /** Raw streamed output (e.g. shell) accumulated during execution */
  outputText?: string
  /** Final tool result once available */
  result?: unknown
  status: 'input-streaming' | 'running' | 'awaiting-approval' | 'suspended' | 'success' | 'error'
}

export interface InfoPart {
  type: 'info'
  level: 'info' | 'error'
  text: string
}

export type MessagePart = TextPart | ReasoningPart | ToolCallPart | InfoPart

export interface UsageInfo {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  [key: string]: number | undefined
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
  usage?: UsageInfo
  checkpointRef?: string | null
  createdAt: number
}

export interface TaskItem {
  id?: string
  content?: string
  status?: string
  [key: string]: unknown
}

export interface PendingApproval {
  toolCallId: string
  toolName: string
  args: unknown
}

export interface PendingSuspension {
  toolCallId: string
  toolName: string
  args?: unknown
  suspendPayload: unknown
  resumeSchema?: string
}

export interface SessionMeta {
  mode?: string
  modelId?: string
  threadId?: string
  yolo?: boolean
  thinkingLevel?: string
}

export type AgentStatus = 'stopped' | 'starting' | 'ready' | 'running' | 'error'

/** Result of one goal-judge evaluation (goal_evaluation event). */
export interface GoalEvaluationInfo {
  objective: string
  iteration: number
  maxRuns: number
  passed: boolean
  status: 'active' | 'paused' | 'done'
  reason?: string
  pausedReason?: string
}

/** A typed Observational Memory progress event (om_* SDK events). */
export interface OmProgressInfo {
  /** SDK event type without the om_ prefix, e.g. 'status', 'observation_end'. */
  kind: string
  data: Record<string, unknown>
  ts: number
}

/** Events streamed to the renderer over the tRPC subscription. */
export type AgentUIEvent =
  | { type: 'message-upsert'; message: StoredMessage }
  | { type: 'messages-reset'; messages: StoredMessage[] }
  | { type: 'approval-request'; approval: PendingApproval }
  | { type: 'approval-resolved'; toolCallId: string }
  | { type: 'suspension-request'; suspension: PendingSuspension }
  | { type: 'suspension-resolved'; toolCallId: string }
  | { type: 'task-list'; tasks: TaskItem[] }
  | { type: 'queue-update'; count: number }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'session-meta'; meta: SessionMeta }
  | { type: 'status'; status: AgentStatus; error?: string }
  | { type: 'run-started' }
  | { type: 'run-finished'; reason?: string }
  | { type: 'info'; level: 'info' | 'error'; text: string }
  | { type: 'goal-update'; goal: GoalEvaluationInfo }
  | { type: 'om-progress'; om: OmProgressInfo }
  | { type: 'raw'; event: unknown }
