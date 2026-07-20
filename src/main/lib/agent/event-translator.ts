/**
 * Translates raw mastracode AgentControllerEvents (forwarded by the agent
 * host) into AgentUIEvents for the renderer, maintaining the streamed
 * message state for one subchat.
 */
import type { AgentControllerEventLike } from '../../../shared/ipc-types'
import type {
  AgentUIEvent,
  MessagePart,
  PendingApproval,
  PendingSuspension,
  StoredMessage,
  TaskItem,
  ToolCallPart,
  UsageInfo
} from '../../../shared/ui-message'

interface ToolMeta {
  status: ToolCallPart['status']
  toolName: string
  args: unknown
  argsText?: string
  outputText?: string
  result?: unknown
}

interface MastraContentItem {
  type: string
  [key: string]: unknown
}

interface MastraMessageLike {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: MastraContentItem[]
  createdAt?: number | string | Date
}

export interface TranslatorCallbacks {
  emit: (event: AgentUIEvent) => void
  /** `final` marks a completed message that must be durable immediately. */
  persistMessage: (message: StoredMessage, final?: boolean) => void
  onThreadChanged: (threadId: string) => void
  onMetaChanged: (meta: {
    mode?: string
    modelId?: string
    yolo?: boolean
    thinkingLevel?: string
  }) => void
  onRunStateChanged: (running: boolean) => void
}

export class EventTranslator {
  private messages = new Map<string, StoredMessage>()
  private toolMeta = new Map<string, ToolMeta>()
  private toolToMessage = new Map<string, string>()
  private currentAssistantId: string | null = null
  readonly pendingApprovals = new Map<string, PendingApproval>()
  readonly pendingSuspensions = new Map<string, PendingSuspension>()
  running = false
  /** Latest agent task list (seeded from boot state, updated by task_updated). */
  tasks: TaskItem[] = []

  constructor(private cb: TranslatorCallbacks) {}

  /** Seed with persisted history so streaming updates merge correctly. */
  seed(messages: StoredMessage[]): void {
    for (const m of messages) this.messages.set(m.id, m)
  }

  handle(ev: AgentControllerEventLike): void {
    switch (ev.type) {
      case 'agent_start':
        this.running = true
        this.cb.onRunStateChanged(true)
        this.cb.emit({ type: 'run-started' })
        break

      case 'agent_end': {
        this.running = false
        this.cb.onRunStateChanged(false)
        // Clear stale gates; the SDK cancels them on run end.
        for (const id of this.pendingApprovals.keys()) {
          this.cb.emit({ type: 'approval-resolved', toolCallId: id })
        }
        this.pendingApprovals.clear()
        this.cb.emit({ type: 'run-finished', reason: ev.reason as string | undefined })
        break
      }

      case 'message_start':
      case 'message_update':
      case 'message_end': {
        const msg = ev.message as unknown as MastraMessageLike
        if (!msg || msg.role !== 'assistant') break
        this.currentAssistantId = msg.id
        this.upsertFromMastra(msg, ev.type === 'message_end')
        break
      }

      case 'tool_input_start': {
        const id = ev.toolCallId as string
        this.ensureTool(id, (ev.toolName as string) ?? 'tool', undefined)
        this.setToolStatus(id, 'input-streaming')
        break
      }

      case 'tool_input_delta': {
        const id = ev.toolCallId as string
        const meta = this.ensureTool(id, (ev.toolName as string) ?? 'tool', undefined)
        meta.argsText = (meta.argsText ?? '') + ((ev.argsTextDelta as string) ?? '')
        try {
          meta.args = JSON.parse(meta.argsText)
        } catch {
          // partial JSON — keep last parsed args
        }
        this.refreshToolPart(id)
        break
      }

      case 'tool_start': {
        const id = ev.toolCallId as string
        const meta = this.ensureTool(id, ev.toolName as string, ev.args)
        meta.args = ev.args
        meta.status = 'running'
        this.refreshToolPart(id)
        break
      }

      case 'tool_update': {
        const id = ev.toolCallId as string
        const meta = this.toolMeta.get(id)
        if (meta) {
          meta.result = ev.partialResult
          this.refreshToolPart(id)
        }
        break
      }

      case 'shell_output': {
        const id = ev.toolCallId as string
        const meta = this.toolMeta.get(id)
        if (meta) {
          meta.outputText = (meta.outputText ?? '') + ((ev.output as string) ?? '')
          this.refreshToolPart(id)
        }
        break
      }

      case 'tool_end': {
        const id = ev.toolCallId as string
        const meta = this.ensureTool(id, 'tool', undefined)
        meta.result = ev.result
        meta.status = ev.isError ? 'error' : 'success'
        if (this.pendingApprovals.delete(id)) {
          this.cb.emit({ type: 'approval-resolved', toolCallId: id })
        }
        if (this.pendingSuspensions.delete(id)) {
          this.cb.emit({ type: 'suspension-resolved', toolCallId: id })
        }
        this.refreshToolPart(id, true)
        break
      }

      case 'tool_approval_required': {
        const id = ev.toolCallId as string
        const approval: PendingApproval = {
          toolCallId: id,
          toolName: ev.toolName as string,
          args: ev.args
        }
        const meta = this.ensureTool(id, approval.toolName, approval.args)
        meta.status = 'awaiting-approval'
        this.pendingApprovals.set(id, approval)
        this.refreshToolPart(id)
        this.cb.emit({ type: 'approval-request', approval })
        break
      }

      case 'tool_suspended': {
        const id = ev.toolCallId as string
        const suspension: PendingSuspension = {
          toolCallId: id,
          toolName: ev.toolName as string,
          args: ev.args,
          suspendPayload: ev.suspendPayload,
          resumeSchema: ev.resumeSchema as string | undefined
        }
        const meta = this.ensureTool(id, suspension.toolName, ev.args)
        meta.status = 'suspended'
        this.pendingSuspensions.set(id, suspension)
        this.refreshToolPart(id)
        this.cb.emit({ type: 'suspension-request', suspension })
        break
      }

      case 'usage_update':
        this.cb.emit({ type: 'usage', usage: (ev.usage ?? {}) as UsageInfo })
        break

      case 'task_updated':
        this.tasks = (ev.tasks ?? []) as TaskItem[]
        this.cb.emit({ type: 'task-list', tasks: this.tasks })
        break

      case 'mode_changed':
        this.cb.onMetaChanged({ mode: ev.modeId as string })
        this.cb.emit({ type: 'session-meta', meta: { mode: ev.modeId as string } })
        break

      case 'model_changed':
        this.cb.onMetaChanged({ modelId: ev.modelId as string })
        this.cb.emit({ type: 'session-meta', meta: { modelId: ev.modelId as string } })
        break

      case 'state_changed': {
        const state = (ev.state ?? {}) as Record<string, unknown>
        const meta = {
          yolo: state.yolo as boolean | undefined,
          thinkingLevel: state.thinkingLevel as string | undefined
        }
        this.cb.onMetaChanged(meta)
        this.cb.emit({ type: 'session-meta', meta })
        if (Array.isArray(state.tasks)) {
          this.tasks = state.tasks as TaskItem[]
          this.cb.emit({ type: 'task-list', tasks: this.tasks })
        }
        break
      }

      case 'thread_created':
      case 'thread_changed': {
        const threadId =
          ev.type === 'thread_created'
            ? ((ev.thread as { id?: string })?.id ?? null)
            : ((ev.threadId as string) ?? null)
        if (threadId) {
          this.cb.onThreadChanged(threadId)
          this.cb.emit({ type: 'session-meta', meta: { threadId } })
        }
        break
      }

      case 'error': {
        const error = ev.error as { message?: string } | undefined
        this.cb.emit({
          type: 'info',
          level: 'error',
          text: error?.message ?? String(ev.error ?? 'Unknown agent error')
        })
        break
      }

      case 'info':
        this.cb.emit({ type: 'info', level: 'info', text: (ev.message as string) ?? '' })
        break

      case 'goal_evaluation': {
        const p = (ev.payload ?? {}) as Record<string, unknown>
        this.cb.emit({
          type: 'goal-update',
          goal: {
            objective: (p.objective as string) ?? '',
            iteration: (p.iteration as number) ?? 0,
            maxRuns: (p.maxRuns as number) ?? 0,
            passed: (p.passed as boolean) ?? false,
            status: (p.status as 'active' | 'paused' | 'done') ?? 'active',
            reason: p.reason as string | undefined,
            pausedReason: p.pausedReason as string | undefined
          }
        })
        break
      }

      case 'follow_up_queued':
        this.cb.emit({ type: 'queue-update', count: (ev.count as number) ?? 0 })
        break

      case 'thread_deleted':
      case 'subagent_model_changed':
        break

      default:
        // om_*, subagent_*, workspace_*, unknown future events
        if (ev.type.startsWith('subagent_')) {
          this.handleSubagent(ev)
        } else if (ev.type.startsWith('om_')) {
          const { type, ...data } = ev
          this.cb.emit({
            type: 'om-progress',
            om: { kind: type.slice('om_'.length), data, ts: Date.now() }
          })
        } else {
          this.cb.emit({ type: 'raw', event: ev })
        }
    }
  }

  private handleSubagent(ev: AgentControllerEventLike): void {
    // Subagent activity is folded into the owning tool call's output text.
    const id = ev.toolCallId as string
    if (!id) return
    const meta = this.toolMeta.get(id)
    if (!meta) return
    if (ev.type === 'subagent_text_delta') {
      meta.outputText = (meta.outputText ?? '') + ((ev.textDelta as string) ?? '')
      this.refreshToolPart(id)
    } else if (ev.type === 'subagent_end') {
      meta.result = ev.result
      this.refreshToolPart(id, true)
    }
  }

  private setToolStatus(id: string, status: ToolCallPart['status']): void {
    const meta = this.toolMeta.get(id)
    if (!meta) return
    meta.status = status
    this.refreshToolPart(id)
  }

  private ensureTool(id: string, toolName: string, args: unknown): ToolMeta {
    let meta = this.toolMeta.get(id)
    if (!meta) {
      meta = { status: 'running', toolName, args }
      this.toolMeta.set(id, meta)
    }
    if (toolName && toolName !== 'tool') meta.toolName = toolName
    if (args !== undefined) meta.args = args
    return meta
  }

  /** Rebuild a StoredMessage from a mastracode message + tool overlays. */
  private upsertFromMastra(msg: MastraMessageLike, persist: boolean): void {
    const parts: MessagePart[] = []
    for (const item of msg.content ?? []) {
      switch (item.type) {
        case 'text':
          if (typeof item.text === 'string' && item.text.length > 0) {
            parts.push({ type: 'text', text: item.text })
          }
          break
        case 'thinking':
          if (typeof item.thinking === 'string' && item.thinking.length > 0) {
            parts.push({ type: 'reasoning', text: item.thinking })
          }
          break
        case 'tool_call': {
          const id = item.id as string
          // Tool events that arrive before this content item map the call to
          // the then-current assistant message (refreshToolPart fallback). If
          // mastracode homes the call in a different message, drop the stale
          // copy so the part doesn't render twice.
          const prevMsgId = this.toolToMessage.get(id)
          if (prevMsgId && prevMsgId !== msg.id) this.removeToolPart(prevMsgId, id)
          this.toolToMessage.set(id, msg.id)
          const meta = this.ensureTool(id, item.name as string, item.args)
          parts.push(this.toolPartFor(id, meta))
          break
        }
        case 'tool_result': {
          // Result for a tool call rendered in this or an earlier message.
          const id = item.id as string
          const meta = this.ensureTool(id, item.name as string, undefined)
          meta.result = item.result
          if (meta.status !== 'error') {
            meta.status = item.isError ? 'error' : 'success'
          }
          break
        }
        default:
          break // system_reminder, signals, notifications — not rendered
      }
    }

    const existing = this.messages.get(msg.id)
    const stored: StoredMessage = {
      id: msg.id,
      role: 'assistant',
      parts,
      checkpointRef: existing?.checkpointRef ?? null,
      createdAt: existing?.createdAt ?? this.toMillis(msg.createdAt)
    }
    this.messages.set(msg.id, stored)
    this.cb.emit({ type: 'message-upsert', message: stored })
    if (persist) this.cb.persistMessage(stored, true)
  }

  /** Drop a tool part from a message it no longer belongs to (re-homed call). */
  private removeToolPart(msgId: string, toolCallId: string): void {
    const stored = this.messages.get(msgId)
    if (!stored) return
    const next = stored.parts.filter(
      (p) => !(p.type === 'tool-call' && p.toolCallId === toolCallId)
    )
    if (next.length === stored.parts.length) return
    stored.parts = next
    this.cb.emit({ type: 'message-upsert', message: stored })
    // Re-persist in case a duplicate copy was already written to the DB, but
    // never insert a now-empty synthesized message.
    if (next.length > 0) this.cb.persistMessage(stored)
  }

  private toolPartFor(id: string, meta: ToolMeta): ToolCallPart {
    return {
      type: 'tool-call',
      toolCallId: id,
      toolName: meta.toolName,
      args: meta.args,
      outputText: meta.outputText,
      result: meta.result,
      status: meta.status
    }
  }

  /** Re-emit (and optionally persist) the message owning a tool call. */
  private refreshToolPart(id: string, persist = false): void {
    const msgId = this.toolToMessage.get(id) ?? this.currentAssistantId
    if (!msgId) return
    const stored = this.messages.get(msgId)
    const meta = this.toolMeta.get(id)
    if (!meta) return

    if (!stored) {
      // Tool event arrived before any assistant message content — synthesize.
      const synthesized: StoredMessage = {
        id: msgId,
        role: 'assistant',
        parts: [this.toolPartFor(id, meta)],
        createdAt: Date.now()
      }
      this.messages.set(msgId, synthesized)
      this.toolToMessage.set(id, msgId)
      this.cb.emit({ type: 'message-upsert', message: synthesized })
      return
    }

    let found = false
    stored.parts = stored.parts.map((p) => {
      if (p.type === 'tool-call' && p.toolCallId === id) {
        found = true
        return this.toolPartFor(id, meta)
      }
      return p
    })
    if (!found) {
      stored.parts.push(this.toolPartFor(id, meta))
      this.toolToMessage.set(id, msgId)
    }
    this.cb.emit({ type: 'message-upsert', message: stored })
    if (persist) this.cb.persistMessage(stored)
  }

  private toMillis(v: number | string | Date | undefined): number {
    if (v === undefined || v === null) return Date.now()
    if (typeof v === 'number') return v
    if (v instanceof Date) return v.getTime()
    const parsed = Date.parse(v)
    return Number.isNaN(parsed) ? Date.now() : parsed
  }
}
