import { useCallback, useReducer } from 'react'
import { trpc } from '../../lib/trpc'
import type {
  AgentStatus,
  AgentUIEvent,
  GoalEvaluationInfo,
  OmProgressInfo,
  PendingApproval,
  PendingSuspension,
  SessionMeta,
  StoredMessage,
  TaskItem,
  UsageInfo
} from '../../../../shared/ui-message'

export interface AgentStreamState {
  messages: StoredMessage[]
  status: AgentStatus
  running: boolean
  approvals: PendingApproval[]
  suspensions: PendingSuspension[]
  meta: SessionMeta
  usage: UsageInfo | null
  tasks: TaskItem[]
  infos: Array<{ level: 'info' | 'error'; text: string; ts: number }>
  /** Latest goal-judge evaluation this session, if any. */
  goal: GoalEvaluationInfo | null
  /** Recent Observational Memory progress events (newest last). */
  omEvents: OmProgressInfo[]
  rawEvents: unknown[]
}

const initialState: AgentStreamState = {
  messages: [],
  status: 'stopped',
  running: false,
  approvals: [],
  suspensions: [],
  meta: {},
  usage: null,
  tasks: [],
  infos: [],
  goal: null,
  omEvents: [],
  rawEvents: []
}

function reducer(state: AgentStreamState, ev: AgentUIEvent): AgentStreamState {
  switch (ev.type) {
    case 'messages-reset':
      return { ...initialState, status: state.status, meta: state.meta, messages: ev.messages }
    case 'message-upsert': {
      const idx = state.messages.findIndex((m) => m.id === ev.message.id)
      const messages =
        idx >= 0
          ? state.messages.map((m, i) => (i === idx ? ev.message : m))
          : [...state.messages, ev.message]
      return { ...state, messages }
    }
    case 'status':
      return { ...state, status: ev.status, running: ev.status === 'stopped' ? false : state.running }
    case 'run-started':
      return { ...state, running: true }
    case 'run-finished':
      return { ...state, running: false, approvals: [], suspensions: [] }
    case 'approval-request':
      if (state.approvals.some((a) => a.toolCallId === ev.approval.toolCallId)) return state
      return { ...state, approvals: [...state.approvals, ev.approval] }
    case 'approval-resolved':
      return { ...state, approvals: state.approvals.filter((a) => a.toolCallId !== ev.toolCallId) }
    case 'suspension-request':
      if (state.suspensions.some((s) => s.toolCallId === ev.suspension.toolCallId)) return state
      return { ...state, suspensions: [...state.suspensions, ev.suspension] }
    case 'suspension-resolved':
      return {
        ...state,
        suspensions: state.suspensions.filter((s) => s.toolCallId !== ev.toolCallId)
      }
    case 'session-meta':
      return { ...state, meta: { ...state.meta, ...ev.meta } }
    case 'usage':
      return { ...state, usage: ev.usage }
    case 'task-list':
      return { ...state, tasks: ev.tasks }
    case 'info':
      return {
        ...state,
        infos: [...state.infos.slice(-49), { level: ev.level, text: ev.text, ts: Date.now() }]
      }
    case 'goal-update':
      return { ...state, goal: ev.goal }
    case 'om-progress':
      return { ...state, omEvents: [...state.omEvents.slice(-29), ev.om] }
    case 'raw':
      return { ...state, rawEvents: [...state.rawEvents.slice(-99), ev.event] }
    default:
      return state
  }
}

export function useAgentStream(subchatId: string | null): AgentStreamState {
  const [state, dispatch] = useReducer(reducer, initialState)

  const onData = useCallback((ev: AgentUIEvent) => dispatch(ev), [])

  trpc.agent.stream.useSubscription(subchatId ? { subchatId } : (undefined as never), {
    enabled: subchatId !== null,
    onData
  })

  return state
}
