/**
 * Translates raw mastracode AgentControllerEvents (forwarded by the agent
 * host) into AgentUIEvents for the renderer, maintaining the streamed
 * message state for one subchat.
 */
import type { AgentControllerEventLike } from '../../../shared/ipc-types'
import type {
  AgentUIEvent,
  GoalEvaluationInfo,
  MessagePart,
  PendingApproval,
  PendingSuspension,
  StoredMessage,
  TaskItem,
  ToolCallPart,
  UsageInfo
} from '../../../shared/ui-message'
import { describeAgentError } from './agent-error-text'
import { withMaxOutputHint } from './max-output-hint'
import { withPrefillHint } from './prefill-error'
import { isStallError } from '../../../shared/stall-error'

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

interface MastraToolInvocationLike {
  toolCallId: string
  toolName: string
  state?: string
  args?: unknown
  result?: unknown
  errorText?: string
}

interface MastraMessageLike {
  id: string
  role: string
  // sdk 1.0.1: MastraMessageContentV2 — AI SDK v4 UI parts under `parts`.
  content: { parts?: MastraContentItem[] } | null
  createdAt?: number | string | Date
}

/**
 * sdk 1.8.x delta payload carried by id-addressed `message_update` events.
 * `message_start` still carries the initial full message; updates are
 * text/reasoning deltas or full part snapshots, and `message_end` is id-only.
 */
interface MastraMessageDeltaLike {
  type?: string
  delta?: string
  index?: number
  part?: MastraContentItem
}

/** sdk 1.0.1 usage_update fields → UsageInfo keys (analytics/cost popover). */
const USAGE_KEY_MAP: Record<string, string> = {
  promptTokens: 'inputTokens',
  completionTokens: 'outputTokens'
}

function normalizeUsage(raw: Record<string, unknown>): UsageInfo {
  const out: UsageInfo = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'number') continue
    const key = USAGE_KEY_MAP[k] ?? k
    out[key] = (out[key] ?? 0) + v
  }
  return out
}

/**
 * Extract the prompt text from a user-prompt echo message. The SDK echoes
 * every user prompt into the run stream as a `role: 'signal'` message with a
 * `data-user-message` part whose `data.contents` is the raw text (or a parts
 * array when files are attached). System reminders and other signals arrive
 * as `data-signal` parts and are ignored. Plain `role: 'user'` messages
 * (older/alternate SDK shapes) fall back to their text parts.
 */
export function userSignalText(msg: MastraMessageLike): string | null {
  if (msg.role !== 'signal' && msg.role !== 'user') return null
  const texts: string[] = []
  for (const item of msg.content?.parts ?? []) {
    if (!item) continue // hole left by an out-of-order 'part' delta
    if (msg.role === 'user' && item.type === 'text' && typeof item.text === 'string') {
      texts.push(item.text)
      continue
    }
    if (item.type !== 'data-user-message') continue
    const contents = (item.data as { contents?: unknown } | undefined)?.contents
    if (typeof contents === 'string') {
      texts.push(contents)
    } else if (Array.isArray(contents)) {
      for (const part of contents) {
        if (!part || typeof part !== 'object') continue
        const p = part as { type?: unknown; text?: unknown }
        if (p.type === 'text' && typeof p.text === 'string') texts.push(p.text)
      }
    }
  }
  const text = texts.join('\n').trim()
  return text.length > 0 ? text : null
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
  /**
   * Called with the raw text of an `error` event. Return true when the owner
   * will auto-recover (e.g. prefill auto-continue) — the transcript then gets
   * an info line instead of the raw provider error.
   */
  onAgentError?: (text: string) => boolean
  /** Called with each goal-judge verdict so it can be persisted as history. */
  onGoalEvaluation?: (goal: GoalEvaluationInfo) => void
  /**
   * Called when the run stream echoes a user prompt (`data-user-message`
   * signal). Fired for every run's prompts — including this app's own sends —
   * so the owner must dedupe against prompts it sent itself before treating
   * it as external (e.g. typed in the CLI).
   */
  onUserMessage?: (msg: { id: string; text: string; createdAt: number }) => void
}

export class EventTranslator {
  private messages = new Map<string, StoredMessage>()
  /**
   * Full mastracode messages accumulated from sdk 1.8.x id-addressed deltas
   * (message_start snapshot + message_update deltas), keyed by message id.
   * Entries are dropped on message_end.
   */
  private mastraShadow = new Map<string, MastraMessageLike>()
  private toolMeta = new Map<string, ToolMeta>()
  private toolToMessage = new Map<string, string>()
  private currentAssistantId: string | null = null
  readonly pendingApprovals = new Map<string, PendingApproval>()
  readonly pendingSuspensions = new Map<string, PendingSuspension>()
  running = false
  /** Latest agent task list (seeded from boot state, updated by task_updated). */
  tasks: TaskItem[] = []
  /** Session-cumulative usage (sum of per-step usage_updates, host lifetime). */
  private sessionUsage: UsageInfo = {}

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
        // Two protocols: pre-1.8 SDKs carry the full message on every event;
        // sdk 1.8.x carries it only on message_start, then id-addressed
        // deltas (message_update) and an id-only message_end. The shadow map
        // accumulates the full mastracode message across deltas so the
        // existing full-message upsert keeps working.
        const msg = ev.message as unknown as MastraMessageLike | undefined
        if (msg) {
          this.mastraShadow.set(msg.id, msg)
          if (msg.role !== 'assistant') {
            // The SDK echoes user prompts as data-user-message signal
            // messages — surface each once, on message_end (old shape).
            if (ev.type === 'message_end') {
              this.emitUserSignal(msg)
              this.mastraShadow.delete(msg.id)
            }
            break
          }
          this.currentAssistantId = msg.id
          this.upsertFromMastra(msg, ev.type === 'message_end')
          if (ev.type === 'message_end') this.mastraShadow.delete(msg.id)
          break
        }
        const id = ev.id as string | undefined
        if (!id) break
        if (ev.type === 'message_update') {
          let target = this.mastraShadow.get(id)
          if (!target) {
            // message_start was missed (host restart mid-message) — deltas
            // only ever stream for assistant messages, so synthesize one.
            target = { id, role: 'assistant', content: { parts: [] } }
            this.mastraShadow.set(id, target)
          }
          this.applyMessageDelta(target, ev.event as MastraMessageDeltaLike | undefined)
          if (target.role === 'assistant') {
            this.currentAssistantId = id
            this.upsertFromMastra(target, false)
          }
        } else if (ev.type === 'message_end') {
          const target = this.mastraShadow.get(id)
          if (target) {
            if (target.role === 'assistant') this.upsertFromMastra(target, true)
            else this.emitUserSignal(target)
            this.mastraShadow.delete(id)
          } else if (this.messages.get(id)?.role === 'assistant') {
            // No shadow (seeded history / synthesized tool message) — still
            // make the finished message durable.
            this.cb.persistMessage(this.messages.get(id)!, true)
          }
        }
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

      case 'tool_suspension_cancelled': {
        // sdk 1.1.1: emitted on stream error for parked suspensions — the SDK
        // has discarded them, so resume can never succeed. Clear the card.
        const id = ev.toolCallId as string
        const meta = this.toolMeta.get(id)
        if (meta) {
          meta.status = 'error'
          meta.result = `Suspension cancelled: ${(ev.reason as string) ?? 'run error'}`
          this.refreshToolPart(id, true)
        }
        if (this.pendingSuspensions.delete(id)) {
          this.cb.emit({ type: 'suspension-resolved', toolCallId: id })
        }
        break
      }

      case 'usage_update': {
        this.applyStepUsage(normalizeUsage((ev.usage ?? {}) as Record<string, unknown>))
        break
      }

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
        // Session state no longer carries the live task list (the SDK's
        // Harness stopped storing it there, so `state.tasks` is always the
        // schema default `[]`). Only seed from it when it actually has tasks
        // (older SDKs / boot snapshots) — never wipe the task_updated-driven
        // list with the empty default, which used to blank the checklist on
        // any mid-run state write (e.g. while a prompt was pending).
        if (Array.isArray(state.tasks) && state.tasks.length > 0) {
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
        // The error payload arrives after a JSON round-trip and can have an
        // empty/missing message (e.g. unavailable-model failures), so use the
        // robust extractor — never render an empty error banner.
        const raw = describeAgentError(ev.error)
        if (this.cb.onAgentError?.(raw)) {
          this.cb.emit({
            type: 'info',
            level: 'info',
            text: isStallError(raw)
              ? 'The run went silent for too long and was stopped — continuing automatically.'
              : 'Provider rejected resuming an assistant reply (assistant prefill not ' +
                'supported) — continuing automatically.'
          })
          break
        }
        this.cb.emit({
          type: 'info',
          level: 'error',
          text: withPrefillHint(withMaxOutputHint(raw))
        })
        break
      }

      case 'info':
        this.cb.emit({ type: 'info', level: 'info', text: (ev.message as string) ?? '' })
        break

      case 'goal_evaluation': {
        const p = (ev.payload ?? {}) as Record<string, unknown>
        const goal: GoalEvaluationInfo = {
          objective: (p.objective as string) ?? '',
          iteration: (p.iteration as number) ?? 0,
          maxRuns: (p.maxRuns as number) ?? 0,
          passed: (p.passed as boolean) ?? false,
          status: (p.status as 'active' | 'paused' | 'done') ?? 'active',
          reason: p.reason as string | undefined,
          pausedReason: p.pausedReason as string | undefined
        }
        this.cb.onGoalEvaluation?.(goal)
        this.cb.emit({ type: 'goal-update', goal })
        break
      }

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

  /** Surface a user-prompt echo (`data-user-message` signal) to the owner. */
  private emitUserSignal(msg: MastraMessageLike): void {
    const text = userSignalText(msg)
    if (text) {
      this.cb.onUserMessage?.({ id: msg.id, text, createdAt: this.toMillis(msg.createdAt) })
    }
  }

  /**
   * Apply one sdk 1.8.x message_update delta to a shadow message, mirroring
   * the SDK's own DisplayState reducer: text-delta appends to the last text
   * part (or opens one), reasoning-delta appends to the reasoning part at
   * `index`, and 'part' replaces the snapshot at `index` (which may leave
   * holes in the array — consumers must skip falsy entries).
   */
  private applyMessageDelta(
    target: MastraMessageLike,
    e: MastraMessageDeltaLike | undefined
  ): void {
    if (!e) return
    target.content ??= { parts: [] }
    const parts = (target.content.parts ??= [])
    if (e.type === 'text-delta' && typeof e.delta === 'string') {
      let last: MastraContentItem | undefined
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i]?.type === 'text') {
          last = parts[i]
          break
        }
      }
      if (last) {
        last.text = (typeof last.text === 'string' ? last.text : '') + e.delta
      } else {
        parts.push({ type: 'text', text: e.delta })
      }
    } else if (e.type === 'reasoning-delta' && typeof e.delta === 'string') {
      const p = typeof e.index === 'number' ? parts[e.index] : undefined
      if (p && p.type === 'reasoning') {
        p.reasoning = (typeof p.reasoning === 'string' ? p.reasoning : '') + e.delta
      }
    } else if (e.type === 'part' && typeof e.index === 'number' && e.part) {
      parts[e.index] = e.part
    }
  }

  /**
   * usage_update carries PER-STEP usage (promptTokens/completionTokens on
   * each step-finish, sdk 1.0.1) — normalize to UsageInfo keys, accumulate
   * into the session total for the cost popover (documented as cumulative),
   * and attribute the step's tokens to the assistant message currently
   * streaming so per-message usage can be aggregated later (Analytics).
   */
  private applyStepUsage(step: UsageInfo): void {
    for (const [key, val] of Object.entries(step)) {
      if (typeof val !== 'number') continue
      this.sessionUsage[key] = (this.sessionUsage[key] ?? 0) + val
    }
    this.cb.emit({ type: 'usage', usage: { ...this.sessionUsage } })
    const msgId = this.currentAssistantId
    if (!msgId) return
    const stored = this.messages.get(msgId)
    if (!stored) return
    const merged: UsageInfo = { ...(stored.usage ?? {}) }
    let changed = false
    for (const [key, val] of Object.entries(step)) {
      if (typeof val !== 'number' || val <= 0) continue
      merged[key] = (merged[key] ?? 0) + val
      changed = true
    }
    if (!changed) return
    stored.usage = merged
    this.cb.persistMessage(stored)
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
    const seenToolIds = new Set<string>()
    for (const item of msg.content?.parts ?? []) {
      if (!item) continue // hole left by an out-of-order 'part' delta
      switch (item.type) {
        case 'text':
          if (typeof item.text === 'string' && item.text.length > 0) {
            parts.push({ type: 'text', text: item.text })
          }
          break
        case 'reasoning':
          if (typeof item.reasoning === 'string' && item.reasoning.length > 0) {
            parts.push({ type: 'reasoning', text: item.reasoning })
          }
          break
        case 'tool-invocation': {
          const inv = item.toolInvocation as MastraToolInvocationLike | undefined
          if (!inv?.toolCallId) break
          const id = inv.toolCallId
          // Tool events that arrive before this content item map the call to
          // the then-current assistant message (refreshToolPart fallback). If
          // mastracode homes the call in a different message, drop the stale
          // copy so the part doesn't render twice.
          const prevMsgId = this.toolToMessage.get(id)
          if (prevMsgId && prevMsgId !== msg.id) this.removeToolPart(prevMsgId, id)
          this.toolToMessage.set(id, msg.id)
          seenToolIds.add(id)
          const meta = this.ensureTool(id, inv.toolName, inv.args)
          if (inv.state === 'result') {
            meta.result = inv.result
            if (meta.status !== 'error') meta.status = 'success'
          } else if (inv.state === 'output-error' || inv.state === 'output-denied') {
            meta.result = inv.errorText ?? inv.result
            meta.status = 'error'
          }
          parts.push(this.toolPartFor(id, meta))
          break
        }
        default:
          break // step-start, file, source, data-* — not rendered
      }
    }

    // A pending gate (awaiting-approval / suspended) homed to this message
    // must survive a content rebuild that omits its invocation — no further
    // tool events arrive while the gate waits on the user, so a dropped part
    // would take the interactive card (the only way to respond) with it and
    // leave the chat blocked on an invisible request.
    const pendingIds = new Set([...this.pendingApprovals.keys(), ...this.pendingSuspensions.keys()])
    for (const id of pendingIds) {
      if (seenToolIds.has(id)) continue
      if ((this.toolToMessage.get(id) ?? this.currentAssistantId) !== msg.id) continue
      const meta = this.toolMeta.get(id)
      if (!meta) continue
      parts.push(this.toolPartFor(id, meta))
      this.toolToMessage.set(id, msg.id)
    }

    const existing = this.messages.get(msg.id)
    const stored: StoredMessage = {
      id: msg.id,
      role: 'assistant',
      parts,
      usage: existing?.usage,
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
