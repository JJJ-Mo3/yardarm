/**
 * Manages one agent host (Electron utilityProcess running mastracode) per
 * subchat. Translates host events into AgentUIEvents, persists messages,
 * and exposes request/response commands to the tRPC layer.
 */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { app, shell, utilityProcess, type UtilityProcess } from 'electron'
import { eq, desc, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { captureCheckpoint } from '../git/ops'
import { EventTranslator } from './event-translator'
import { IdeEditTracker, formatIdeEditNote } from './ide-edit-notes'
import { clampMessageForStorage } from './message-clamp'
import { isPrefillError } from './prefill-error'
import { PromptQueue } from './prompt-queue'
import {
  normalizeCustomProviderModelId,
  normalizeCustomProviderModels
} from './custom-provider-models'
import { readSettings } from '../mastra-config/settings-json'
import { MessageWriteBuffer } from './message-write-buffer'
import { createUpsertThrottle } from './upsert-throttle'
import type {
  AgentControllerEventLike,
  AuthEntry,
  FileAttachment,
  GoalInfo,
  HostBootConfig,
  HostCommand,
  HostMessage,
  IdeNoteResult,
  ModelInfo,
  OAuthProviderInfo,
  OAuthStatusEvent,
  OmRuntimeInfo,
  OmRuntimePatch,
  PacksInfo,
  PermissionPolicy,
  PermissionsSnapshot,
  PluginInfo,
  PluginScope,
  ResourceInfo,
  SessionStateInfo,
  SessionStatePatch,
  SkillInfo,
  SlashCommandInfo,
  SttModelInfo,
  ThreadInfo
} from '../../../shared/ipc-types'
import type {
  AgentStatus,
  AgentUIEvent,
  QueuedPromptInfo,
  SessionMeta,
  StoredMessage,
  SubchatStatusInfo,
  TaskItem
} from '../../../shared/ui-message'

const HOST_ENTRY = path.join(__dirname, 'agent-host.js')

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

interface HostHandle {
  proc: UtilityProcess
  subchatId: string
  status: AgentStatus
  translator: EventTranslator
  pending: Map<string, PendingRequest>
  meta: {
    threadId?: string
    mode?: string
    modelId?: string
    yolo?: boolean
    thinkingLevel?: string
  }
  readyPromise: Promise<void>
  readyResolve: () => void
  readyReject: (err: Error) => void
  killed: boolean
}

const REQUEST_TIMEOUT_MS = 30_000
/** Upper bound on the total JSON bytes a loadMessages seed may carry. */
const SEED_BYTE_BUDGET = 24 * 1024 * 1024
/** Debounce for mid-run IDE-edit note delivery, batching rapid Cmd+S saves. */
const IDE_NOTE_DEBOUNCE_MS = 1200

export class AgentSessionManager {
  private hosts = new Map<string, HostHandle>()
  private emitters = new Map<string, EventEmitter>()
  /** A host with cwd=$HOME used for auth/model queries when no chat host exists. */
  private utilityHost: HostHandle | null = null
  /** Most recent boot-error from any host; cleared when a host boots cleanly. */
  private lastBootError: string | null = null
  /** Debounces the per-tool-call full-row rewrites of streaming messages. */
  private writeBuffer = new MessageWriteBuffer((sid, m) => this.writeMessageRow(sid, m))
  /** Prompts submitted while a run was active, flushed FIFO on run end. */
  private promptQueue = new PromptQueue()
  /**
   * Subchats with a queued prompt dispatched but no agent_start seen yet.
   * Doubles as the flush lock so duplicate agent_end events can't double-send.
   */
  private awaitingRunStart = new Set<string>()
  /** Subchats whose current run errored with a provider prefill rejection. */
  private prefillRetryPending = new Set<string>()
  /**
   * One-shot auto-continue budget: set when a recovery is dispatched, cleared
   * on the next real user send so each prompt re-arms exactly one retry.
   */
  private prefillRetried = new Set<string>()
  /** Files the user saved from the IDE, reported to the agent mid-run or on its next prompt. */
  private ideEdits = new IdeEditTracker()
  /** Pending per-subchat debounce timers for mid-run IDE-note delivery. */
  private ideNoteTimers = new Map<string, NodeJS.Timeout>()

  private emitterFor(subchatId: string): EventEmitter {
    let em = this.emitters.get(subchatId)
    if (!em) {
      em = new EventEmitter()
      em.setMaxListeners(50)
      this.emitters.set(subchatId, em)
    }
    return em
  }

  private emitUI(subchatId: string, event: AgentUIEvent): void {
    this.emitterFor(subchatId).emit('event', event)
    switch (event.type) {
      case 'run-started':
      case 'run-finished':
      case 'approval-request':
      case 'approval-resolved':
      case 'suspension-request':
      case 'suspension-resolved':
      case 'status':
        this.broadcastStatus(subchatId)
    }
  }

  onEvents(subchatId: string, listener: (ev: AgentUIEvent) => void): () => void {
    const em = this.emitterFor(subchatId)
    em.on('event', listener)
    return () => em.off('event', listener)
  }

  // ---- Cross-chat status (sidebar activity indicators) ---------------------

  /** Broadcasts per-subchat status snapshots to the statusAll subscription. */
  private statusEmitter = new EventEmitter()
  /** Immutable subchat → chat mapping, cached to avoid a DB hit per event. */
  private chatIdCache = new Map<string, string>()
  /** Last broadcast per subchat ('running|pendingCount'), to drop no-op emits. */
  private lastStatusKey = new Map<string, string>()

  onStatus(listener: (info: SubchatStatusInfo) => void): () => void {
    this.statusEmitter.on('status', listener)
    return () => this.statusEmitter.off('status', listener)
  }

  private chatIdFor(subchatId: string): string | null {
    const cached = this.chatIdCache.get(subchatId)
    if (cached) return cached
    const row = getDb()
      .select({ chatId: schema.subchats.chatId })
      .from(schema.subchats)
      .where(eq(schema.subchats.id, subchatId))
      .get()
    if (!row) return null // deleted subchat or the utility host
    this.chatIdCache.set(subchatId, row.chatId)
    return row.chatId
  }

  private computeStatus(subchatId: string): { running: boolean; pendingCount: number } {
    const host = this.hosts.get(subchatId)
    if (!host || host.killed) return { running: false, pendingCount: 0 }
    const t = host.translator
    return {
      running: t.running,
      pendingCount: t.pendingApprovals.size + t.pendingSuspensions.size
    }
  }

  private broadcastStatus(subchatId: string): void {
    if (subchatId === '__utility__') return
    const chatId = this.chatIdFor(subchatId)
    if (!chatId) return
    const { running, pendingCount } = this.computeStatus(subchatId)
    const key = `${running}|${pendingCount}`
    if (this.lastStatusKey.get(subchatId) === key) return
    this.lastStatusKey.set(subchatId, key)
    const info: SubchatStatusInfo = { subchatId, chatId, running, pendingCount }
    this.statusEmitter.emit('status', info)
  }

  /** Live status for every chat host (idle ones included), for stream seeding. */
  statusSnapshot(): SubchatStatusInfo[] {
    const out: SubchatStatusInfo[] = []
    for (const subchatId of this.hosts.keys()) {
      if (subchatId === '__utility__') continue
      const chatId = this.chatIdFor(subchatId)
      if (!chatId) continue
      out.push({ subchatId, chatId, ...this.computeStatus(subchatId) })
    }
    return out
  }

  /**
   * Push a fresh full message list to any open stream subscriptions, e.g.
   * after a rollback truncates history behind the subscription's back.
   */
  notifyMessagesReset(subchatId: string): void {
    this.emitUI(subchatId, { type: 'messages-reset', messages: this.loadMessages(subchatId) })
  }

  status(subchatId: string): AgentStatus {
    return this.hosts.get(subchatId)?.status ?? 'stopped'
  }

  isRunning(subchatId: string): boolean {
    return this.hosts.get(subchatId)?.translator.running ?? false
  }

  meta(subchatId: string): HostHandle['meta'] | null {
    return this.hosts.get(subchatId)?.meta ?? null
  }

  /** Session meta from the DB row, for seeding streams when no host is live. */
  persistedMeta(subchatId: string): SessionMeta {
    const row = getDb()
      .select({
        mode: schema.subchats.mode,
        modelId: schema.subchats.modelId,
        thinkingLevel: schema.subchats.thinkingLevel,
        mastraThreadId: schema.subchats.mastraThreadId
      })
      .from(schema.subchats)
      .where(eq(schema.subchats.id, subchatId))
      .get()
    if (!row) return {}
    return {
      mode: row.mode ?? undefined,
      modelId: row.modelId ?? undefined,
      thinkingLevel: row.thinkingLevel ?? undefined,
      threadId: row.mastraThreadId ?? undefined,
      // Boot always starts hosts with yolo off (see ensureHost), so this is accurate.
      yolo: false
    }
  }

  /** Latest agent task list, for seeding new stream subscribers. */
  tasks(subchatId: string): TaskItem[] {
    return this.hosts.get(subchatId)?.translator.tasks ?? []
  }

  pendingApprovals(subchatId: string): AgentUIEvent[] {
    const host = this.hosts.get(subchatId)
    if (!host) return []
    const events: AgentUIEvent[] = []
    for (const approval of host.translator.pendingApprovals.values()) {
      events.push({ type: 'approval-request', approval })
    }
    for (const suspension of host.translator.pendingSuspensions.values()) {
      events.push({ type: 'suspension-request', suspension })
    }
    return events
  }

  loadMessages(subchatId: string): StoredMessage[] {
    // Reads must see everything that streamed so far, not stale rows.
    this.writeBuffer.flush(subchatId)
    const db = getDb()
    // Bounded: only the most recent messages, so translator seeding and the
    // messages-reset renderer payload stay small as history grows.
    const rows = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.subchatId, subchatId))
      .orderBy(desc(schema.messages.seq))
      .limit(500)
      .all()
    // Byte guard on top of the row cap: stop including older rows once the
    // seed payload would get too large to ship over IPC comfortably.
    const included: typeof rows = []
    let bytes = 0
    for (const r of rows) {
      bytes += r.parts.length
      if (included.length > 0 && bytes > SEED_BYTE_BUDGET) break
      included.push(r)
    }
    included.reverse()
    return included.map((r) => ({
      id: r.id,
      role: r.role as StoredMessage['role'],
      parts: JSON.parse(r.parts) as StoredMessage['parts'],
      usage: r.usage ? (JSON.parse(r.usage) as StoredMessage['usage']) : undefined,
      checkpointRef: r.checkpointRef,
      createdAt: r.createdAt
    }))
  }

  /**
   * Queue a message write. Streaming re-persists (once per tool call on a
   * growing message) coalesce through the write buffer's short debounce;
   * `flush` forces an immediate durable write for finalized messages.
   */
  private persistMessage(subchatId: string, rawMessage: StoredMessage, flush = false): void {
    // Clamp oversized tool payloads before they hit disk.
    const message = clampMessageForStorage(rawMessage)
    this.writeBuffer.enqueue(subchatId, message, { flush })
  }

  /** Single-statement upsert: insert with the next seq, or refresh the row. */
  private writeMessageRow(subchatId: string, message: StoredMessage): void {
    const db = getDb()
    const parts = JSON.stringify(message.parts)
    const usage = message.usage ? JSON.stringify(message.usage) : null
    db.insert(schema.messages)
      .values({
        id: message.id,
        subchatId,
        role: message.role,
        parts,
        usage,
        checkpointRef: message.checkpointRef ?? null,
        seq: sql`(select coalesce(max(${schema.messages.seq}), 0) + 1 from ${schema.messages} where ${schema.messages.subchatId} = ${subchatId})`,
        createdAt: message.createdAt
      })
      .onConflictDoUpdate({
        target: schema.messages.id,
        set: { parts, usage }
      })
      .run()
  }

  /** Ensure a host process exists for the subchat; boots one if needed. */
  async ensureHost(subchatId: string): Promise<HostHandle> {
    const existing = this.hosts.get(subchatId)
    if (existing && !existing.killed) {
      await existing.readyPromise
      return existing
    }

    const db = getDb()
    const subchat = db.select().from(schema.subchats).where(eq(schema.subchats.id, subchatId)).get()
    if (!subchat) throw new Error(`Subchat not found: ${subchatId}`)
    const chat = db.select().from(schema.chats).where(eq(schema.chats.id, subchat.chatId)).get()
    if (!chat) throw new Error(`Chat not found: ${subchat.chatId}`)
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, chat.projectId))
      .get()
    if (!project) throw new Error(`Project not found: ${chat.projectId}`)

    const cwd = chat.worktreePath ?? project.path
    // Stored ids may predate catalog-id normalization (gateway-prefixed custom
    // provider ids the SDK can't resolve) — normalize before handing to the host.
    // The resulting model_changed event persists the normalized id back.
    const modelId = subchat.modelId
      ? normalizeCustomProviderModelId(
          subchat.modelId,
          (await readSettings()).customProviders ?? []
        )
      : undefined
    const boot: HostBootConfig = {
      cwd,
      threadId: subchat.mastraThreadId ?? undefined,
      mode: subchat.mode ?? undefined,
      modelId,
      thinkingLevel: subchat.thinkingLevel ?? undefined,
      yolo: false
    }

    const handle = this.spawnHost(subchatId, boot)
    this.hosts.set(subchatId, handle)
    this.emitUI(subchatId, { type: 'status', status: 'starting' })
    await handle.readyPromise
    return handle
  }

  private spawnHost(subchatId: string, boot: HostBootConfig): HostHandle {
    if (app.isPackaged) {
      // Use the vendored runtime (Resources/agent-runtime) instead of the
      // walker-bundled node_modules; see scripts/build-agent-runtime.mjs.
      boot = { ...boot, agentRuntimePath: path.join(process.resourcesPath, 'agent-runtime') }
    }
    const proc = utilityProcess.fork(HOST_ENTRY, [], {
      serviceName: `yardarm-agent-${subchatId}`,
      stdio: 'pipe',
      env: {
        ...process.env,
        YARDARM_BOOT: JSON.stringify(boot)
      }
    })

    let readyResolve!: () => void
    let readyReject!: (err: Error) => void
    const readyPromise = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    // Avoid unhandled rejection if nobody awaits before failure.
    readyPromise.catch(() => {})

    // Streaming deltas arrive far faster than the renderer needs; coalesce
    // full-message upserts per message id before they cross IPC.
    const throttle = createUpsertThrottle((ev) => this.emitUI(subchatId, ev))
    const translator = new EventTranslator({
      emit: (ev) => {
        throttle.emit(ev)
        // A resolved approval/suspension unblocks held IDE-edit notes — the
        // host declined to signal past that gate, so retry now.
        if (
          (ev.type === 'approval-resolved' || ev.type === 'suspension-resolved') &&
          this.ideEdits.hasPending(subchatId)
        ) {
          this.scheduleIdeNoteDelivery(subchatId)
        }
      },
      persistMessage: (m, final) => this.persistMessage(subchatId, m, final),
      onThreadChanged: (threadId) => {
        handle.meta.threadId = threadId
        getDb()
          .update(schema.subchats)
          .set({ mastraThreadId: threadId })
          .where(eq(schema.subchats.id, subchatId))
          .run()
      },
      onMetaChanged: (meta) => {
        Object.assign(handle.meta, meta)
        const updates: Record<string, unknown> = {}
        if (meta.mode !== undefined) updates.mode = meta.mode
        if (meta.modelId !== undefined) updates.modelId = meta.modelId
        if (meta.thinkingLevel !== undefined) updates.thinkingLevel = meta.thinkingLevel
        if (Object.keys(updates).length > 0) {
          getDb()
            .update(schema.subchats)
            .set(updates)
            .where(eq(schema.subchats.id, subchatId))
            .run()
        }
      },
      onRunStateChanged: (running) => {
        // agent_start confirms the dispatched queue item took; agent_end on
        // an error path (no agent_start) must also release the lock.
        this.awaitingRunStart.delete(subchatId)
        if (!running) {
          // Auto-continue first: if it dispatches, it holds awaitingRunStart
          // and the flush guard below skips (same lock discipline as flushes).
          this.maybeAutoContinue(subchatId)
          this.maybeFlushQueue(subchatId)
        } else {
          // IDE edits saved during the awaitingRunStart gap (or while an
          // approval was parked) couldn't be delivered — push them onto the
          // now-live run. No-op when the tracker is empty.
          this.scheduleIdeNoteDelivery(subchatId)
        }
      },
      onAgentError: (text) => {
        if (!isPrefillError(text) || this.prefillRetried.has(subchatId)) return false
        this.prefillRetryPending.add(subchatId)
        // Errors emitted outside a run get no agent_end; recover directly,
        // deferred so we never send from inside translator.handle.
        if (!this.isRunning(subchatId)) {
          queueMicrotask(() => this.maybeAutoContinue(subchatId))
        }
        return true
      }
    })
    translator.seed(this.loadMessages(subchatId))

    const handle: HostHandle = {
      proc,
      subchatId,
      status: 'starting',
      translator,
      pending: new Map(),
      meta: {},
      readyPromise,
      readyResolve,
      readyReject,
      killed: false
    }

    proc.stdout?.on('data', (d: Buffer) => {
      console.log(`[agent-host ${subchatId}]`, d.toString().trimEnd())
    })
    proc.stderr?.on('data', (d: Buffer) => {
      console.error(`[agent-host ${subchatId}]`, d.toString().trimEnd())
    })

    proc.on('message', (raw: unknown) => {
      const msg = raw as HostMessage
      switch (msg.t) {
        case 'ready':
          this.lastBootError = null
          handle.status = 'ready'
          handle.meta = {
            threadId: msg.threadId ?? undefined,
            mode: msg.mode,
            modelId: msg.modelId,
            yolo: (msg.state as Record<string, unknown> | undefined)?.yolo as boolean | undefined,
            thinkingLevel: (msg.state as Record<string, unknown> | undefined)?.thinkingLevel as
              string | undefined
          }
          {
            // Seed the task list from boot state so the panel reflects
            // existing tasks before the next task_updated event.
            const bootTasks = (msg.state as Record<string, unknown> | undefined)?.tasks
            if (Array.isArray(bootTasks)) handle.translator.tasks = bootTasks as TaskItem[]
          }
          if (msg.threadId) {
            getDb()
              .update(schema.subchats)
              .set({ mastraThreadId: msg.threadId })
              .where(eq(schema.subchats.id, subchatId))
              .run()
          }
          this.emitUI(subchatId, { type: 'status', status: 'ready' })
          this.emitUI(subchatId, {
            type: 'session-meta',
            meta: {
              threadId: msg.threadId ?? undefined,
              mode: msg.mode,
              modelId: msg.modelId,
              yolo: handle.meta.yolo,
              thinkingLevel: handle.meta.thinkingLevel
            }
          })
          handle.readyResolve()
          break
        case 'boot-error':
          this.lastBootError = msg.error
          handle.status = 'error'
          this.emitUI(subchatId, { type: 'status', status: 'error', error: msg.error })
          handle.readyReject(new Error(msg.error))
          break
        case 'event':
          try {
            handle.translator.handle(msg.ev as AgentControllerEventLike)
          } catch (err) {
            console.error(`[agent ${subchatId}] translator error`, err)
          }
          break
        case 'response': {
          const req = handle.pending.get(msg.reqId)
          if (req) {
            handle.pending.delete(msg.reqId)
            clearTimeout(req.timer)
            if (msg.ok) req.resolve(msg.data)
            else req.reject(new Error(msg.error ?? 'Agent host request failed'))
          }
          break
        }
        case 'oauth-status':
          this.relayOauthStatus({
            flowId: msg.reqId,
            kind: msg.kind,
            url: msg.url,
            instructions: msg.instructions,
            message: msg.message,
            placeholder: msg.placeholder
          })
          break
        case 'log':
          console.log(`[agent-host ${subchatId}]`, msg.msg)
          break
      }
    })

    proc.on('exit', (code) => {
      handle.killed = true
      handle.status = 'stopped'
      // No auto-flush on host death (avoids crash-respawn loops); the queue
      // stays intact and resumes via the sendOrQueue idle kick.
      this.awaitingRunStart.delete(subchatId)
      this.prefillRetryPending.delete(subchatId)
      throttle.dispose()
      this.writeBuffer.flush(subchatId)
      for (const [, req] of handle.pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Agent host exited'))
      }
      handle.pending.clear()
      if (this.hosts.get(subchatId) === handle) this.hosts.delete(subchatId)
      handle.readyReject(new Error(`Agent host exited with code ${code}`))
      this.emitUI(subchatId, { type: 'status', status: 'stopped' })
      if (handle.translator.running) {
        this.emitUI(subchatId, { type: 'run-finished', reason: 'error' })
        this.emitUI(subchatId, {
          type: 'info',
          level: 'error',
          text: `Agent process exited unexpectedly (code ${code}).`
        })
      }
    })

    return handle
  }

  private sendCommand(handle: HostHandle, cmd: HostCommand): void {
    handle.proc.postMessage(cmd)
  }

  private request<T>(
    handle: HostHandle,
    cmd: HostCommand & { reqId: string },
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        handle.pending.delete(cmd.reqId)
        reject(new Error(`Agent host request timed out: ${cmd.t}`))
      }, timeoutMs)
      handle.pending.set(cmd.reqId, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer
      })
      handle.proc.postMessage(cmd)
    })
  }

  // ---- Public command surface -------------------------------------------

  /** Persist + broadcast a user message and touch the chat's updatedAt. */
  private recordUserMessage(subchatId: string, text: string, checkpointRef?: string): void {
    const userMessage: StoredMessage = {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text }],
      checkpointRef: checkpointRef ?? null,
      createdAt: Date.now()
    }
    this.persistMessage(subchatId, userMessage, true)
    this.emitUI(subchatId, { type: 'message-upsert', message: userMessage })
    const db = getDb()
    const subchat = db
      .select({ chatId: schema.subchats.chatId })
      .from(schema.subchats)
      .where(eq(schema.subchats.id, subchatId))
      .get()
    if (subchat) {
      db.update(schema.chats)
        .set({ updatedAt: Date.now() })
        .where(eq(schema.chats.id, subchat.chatId))
        .run()
    }
  }

  /**
   * One-time note (e.g. rollback) appended to the next model-bound prompt as
   * a `<system-reminder>` suffix. Appended — never prepended — because the
   * SDK treats a user message whose first text starts with `<system-reminder`
   * as a reminder and filters it from later recalls, which would erase the
   * user's actual prompt from agent memory.
   */
  private consumePendingNote(subchatId: string): string {
    const db = getDb()
    const row = db
      .select({ pendingNote: schema.subchats.pendingNote })
      .from(schema.subchats)
      .where(eq(schema.subchats.id, subchatId))
      .get()
    if (!row?.pendingNote) return ''
    db.update(schema.subchats)
      .set({ pendingNote: null })
      .where(eq(schema.subchats.id, subchatId))
      .run()
    return `\n\n<system-reminder>\n${row.pendingNote}\n</system-reminder>`
  }

  /**
   * Record a user IDE edit for every subchat of a chat (they share the
   * worktree). Delivered onto the active run as a system-reminder signal
   * (debounced) when the agent is running, otherwise held and appended as a
   * `<system-reminder>` suffix on the subchat's next prompt — never by
   * starting a run of its own.
   */
  noteIdeEdit(chatId: string, filePath: string): void {
    const db = getDb()
    const rows = db
      .select({ id: schema.subchats.id })
      .from(schema.subchats)
      .where(eq(schema.subchats.chatId, chatId))
      .all()
    if (rows.length) {
      this.ideEdits.add(
        rows.map((r) => r.id),
        filePath
      )
      for (const r of rows) this.scheduleIdeNoteDelivery(r.id)
    }
  }

  /** Forget pending IDE-edit notes for a subchat (chat/project deletion). */
  clearIdeEdits(subchatId: string): void {
    this.clearIdeNoteTimer(subchatId)
    this.ideEdits.clear(subchatId)
  }

  /** (Re)start the delivery debounce so rapid saves coalesce into one note. */
  private scheduleIdeNoteDelivery(subchatId: string): void {
    const existing = this.ideNoteTimers.get(subchatId)
    if (existing) clearTimeout(existing)
    this.ideNoteTimers.set(
      subchatId,
      setTimeout(() => {
        this.ideNoteTimers.delete(subchatId)
        void this.deliverIdeEditsNow(subchatId)
      }, IDE_NOTE_DEBOUNCE_MS)
    )
  }

  private clearIdeNoteTimer(subchatId: string): void {
    const timer = this.ideNoteTimers.get(subchatId)
    if (timer) {
      clearTimeout(timer)
      this.ideNoteTimers.delete(subchatId)
    }
  }

  /**
   * Push pending IDE-edit notes onto the active run as a system-reminder
   * signal. Only fires into a live, running host; the host itself is the
   * authority on whether the signal is safe (its live displayState knows
   * about parked approvals/suspensions — the translator's mirror must NOT be
   * consulted here, because suspension entries deliberately outlive run end
   * and would permanently gate delivery). Held/failed notes are re-added and
   * retried when the gate resolves, or ride the next prompt's suffix.
   */
  private async deliverIdeEditsNow(subchatId: string): Promise<void> {
    const host = this.hosts.get(subchatId)
    if (!host || host.killed || host.status !== 'ready') return
    if (!this.isRunning(subchatId)) return // idle → next-prompt suffix path
    const paths = this.ideEdits.drain(subchatId)
    if (paths.length === 0) return
    try {
      const res = await this.request<IdeNoteResult>(host, {
        t: 'ideNote',
        reqId: randomUUID(),
        text: formatIdeEditNote(paths)
      })
      if (res.delivered) {
        console.log(`[agent ${subchatId}] ide-note delivered mid-run: ${paths.join(', ')}`)
      } else {
        console.log(`[agent ${subchatId}] ide-note held (${res.reason ?? 'unknown'}), will retry`)
        for (const p of paths) this.ideEdits.add([subchatId], p)
      }
    } catch (err) {
      console.error(`[agent ${subchatId}] ide-note delivery failed, re-queued`, err)
      for (const p of paths) this.ideEdits.add([subchatId], p)
    }
  }

  /**
   * Send a prompt to the agent. `displayText` (when set) is what the
   * transcript stores/shows — e.g. `/cmd args` — while `content` is the
   * expanded prompt actually sent to the model.
   */
  async sendMessage(
    subchatId: string,
    content: string,
    checkpointRef?: string,
    displayText?: string,
    files?: FileAttachment[]
  ): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    const attachmentNote = files?.length
      ? `\n\n[${files.length} file${files.length === 1 ? '' : 's'} attached]`
      : ''
    const noteSuffix = this.consumePendingNote(subchatId)
    const ideNote = formatIdeEditNote(this.ideEdits.drain(subchatId))
    const ideSuffix = ideNote ? `\n\n<system-reminder>\n${ideNote}\n</system-reminder>` : ''
    this.prefillRetried.delete(subchatId) // each real send re-arms one auto-recovery
    this.recordUserMessage(subchatId, (displayText ?? content) + attachmentNote, checkpointRef)
    this.sendCommand(handle, { t: 'send', text: content + noteSuffix + ideSuffix, files })
  }

  // ---- Prompt queue (send-while-running) ----------------------------------

  /** Working directory for a subchat (worktree > project path), or null. */
  private subchatCwd(subchatId: string): string | null {
    const db = getDb()
    const subchat = db
      .select({ chatId: schema.subchats.chatId })
      .from(schema.subchats)
      .where(eq(schema.subchats.id, subchatId))
      .get()
    if (!subchat) return null
    const chat = db
      .select({ worktreePath: schema.chats.worktreePath, projectId: schema.chats.projectId })
      .from(schema.chats)
      .where(eq(schema.chats.id, subchat.chatId))
      .get()
    if (!chat) return null
    if (chat.worktreePath) return chat.worktreePath
    const project = db
      .select({ path: schema.projects.path })
      .from(schema.projects)
      .where(eq(schema.projects.id, chat.projectId))
      .get()
    return project?.path ?? null
  }

  /** Rollback checkpoint captured at actual send time (not enqueue time). */
  private async captureSendCheckpoint(subchatId: string): Promise<string | undefined> {
    const cwd = this.subchatCwd(subchatId)
    if (!cwd) return undefined
    return (await captureCheckpoint(cwd)) ?? undefined
  }

  private emitQueuedPrompts(subchatId: string): void {
    this.emitUI(subchatId, { type: 'queued-prompts', items: this.promptQueue.list(subchatId) })
  }

  /**
   * Send a prompt, or queue it when a run is active (or other prompts are
   * already waiting — FIFO order is preserved even after a host crash). The
   * main process is authoritative here so a stale `running` in the renderer
   * can't misroute a prompt.
   */
  async sendOrQueue(subchatId: string, content: string, files?: FileAttachment[]): Promise<void> {
    const busy =
      this.isRunning(subchatId) ||
      this.awaitingRunStart.has(subchatId) ||
      this.promptQueue.size(subchatId) > 0
    if (!busy) {
      const checkpointRef = await this.captureSendCheckpoint(subchatId)
      await this.sendMessage(subchatId, content, checkpointRef, undefined, files)
      return
    }
    this.promptQueue.enqueue(subchatId, content, files)
    this.emitQueuedPrompts(subchatId)
    // Idle kick: if the queue was stranded (host crash, failed flush), this
    // enqueue is the moment it resumes — head first, order preserved.
    this.maybeFlushQueue(subchatId)
  }

  dismissQueuedPrompt(subchatId: string, id: string): void {
    if (this.promptQueue.dismiss(subchatId, id)) this.emitQueuedPrompts(subchatId)
  }

  /** Renderer-safe queue snapshot, for stream seeding. */
  queuedPrompts(subchatId: string): QueuedPromptInfo[] {
    return this.promptQueue.list(subchatId)
  }

  /**
   * Flush the next queued prompt if the subchat is idle. Never flushes while
   * a suspension (ask_user / plan approval) is pending — sending steers into
   * the gate and force-declines it. The awaitingRunStart lock is taken
   * synchronously so duplicate agent_end events can't double-send.
   */
  private maybeFlushQueue(subchatId: string): void {
    if (this.promptQueue.size(subchatId) === 0) return
    if (this.isRunning(subchatId) || this.awaitingRunStart.has(subchatId)) return
    const pendingSuspensions = this.hosts.get(subchatId)?.translator.pendingSuspensions
    if (pendingSuspensions && pendingSuspensions.size > 0) return
    const item = this.promptQueue.shift(subchatId)
    if (!item) return
    this.awaitingRunStart.add(subchatId)
    this.emitQueuedPrompts(subchatId)
    // Deferred so a flush triggered from inside translator.handle never
    // interleaves with the event currently being processed.
    void (async () => {
      const checkpointRef = await this.captureSendCheckpoint(subchatId)
      await this.sendMessage(subchatId, item.text, checkpointRef, undefined, item.files)
    })().catch((err: unknown) => {
      this.awaitingRunStart.delete(subchatId)
      this.promptQueue.unshift(subchatId, item)
      this.emitQueuedPrompts(subchatId)
      this.emitUI(subchatId, {
        type: 'info',
        level: 'error',
        text: `Failed to send queued message: ${err instanceof Error ? err.message : String(err)}`
      })
    })
  }

  /**
   * One-shot recovery from a provider "assistant message prefill" rejection:
   * send a hidden continue message so the conversation ends with a user
   * message, which is all the provider demands. The `<system-reminder>`
   * prefix makes the SDK filter it from later recalls, so no fake user turn
   * pollutes agent memory — and no user bubble is recorded; the translator's
   * info line is the transcript record. Skipped when queued prompts exist
   * (the queued user prompt fixes the trailing-assistant state by itself)
   * and while suspensions are pending (same rule as the prompt queue).
   */
  private maybeAutoContinue(subchatId: string): void {
    if (!this.prefillRetryPending.has(subchatId)) return
    if (this.isRunning(subchatId) || this.awaitingRunStart.has(subchatId)) return
    this.prefillRetryPending.delete(subchatId)
    if (this.promptQueue.size(subchatId) > 0) return
    const handle = this.hosts.get(subchatId)
    if (!handle || handle.killed) return
    if (handle.translator.pendingSuspensions.size > 0) return
    this.prefillRetried.add(subchatId)
    this.awaitingRunStart.add(subchatId)
    this.sendCommand(handle, {
      t: 'send',
      text:
        '<system-reminder>\nThe previous model call failed because this provider cannot ' +
        'resume an assistant reply (assistant message prefill). Continue from where you ' +
        'left off.\n</system-reminder>'
    })
  }

  async approve(
    subchatId: string,
    toolCallId: string,
    decision: 'approve' | 'decline' | 'always_allow_category',
    feedback?: string
  ): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'approve', toolCallId, decision, feedback })
  }

  async alwaysAllowTool(subchatId: string, toolName: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'alwaysAllowTool', toolName })
  }

  async respondSuspension(
    subchatId: string,
    toolCallId: string,
    resumeData: unknown
  ): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'suspension', toolCallId, resumeData })
  }

  abort(subchatId: string): void {
    const handle = this.hosts.get(subchatId)
    if (handle && !handle.killed) this.sendCommand(handle, { t: 'abort' })
  }

  async setMode(subchatId: string, modeId: string): Promise<void> {
    // Persist first so the mode survives with no host running — the next boot
    // applies it via HostBootConfig.mode and the SDK enforces it per message.
    getDb()
      .update(schema.subchats)
      .set({ mode: modeId })
      .where(eq(schema.subchats.id, subchatId))
      .run()
    // Optimistic UI update; a live host re-confirms via mode_changed.
    this.emitUI(subchatId, { type: 'session-meta', meta: { mode: modeId } })
    const handle = this.hosts.get(subchatId)
    if (!handle || handle.killed) return
    handle.meta.mode = modeId
    try {
      // Wait for boot so our switch lands after the (possibly stale) boot mode.
      await handle.readyPromise
      this.sendCommand(handle, { t: 'setMode', mode: modeId })
    } catch {
      // Host failed to boot — the DB write already covers the next boot.
    }
  }

  async setModel(subchatId: string, modelId: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    // Defensive: strip gateway-prefixed custom-provider ids the SDK can't resolve.
    const settings = await readSettings()
    this.sendCommand(handle, {
      t: 'setModel',
      modelId: normalizeCustomProviderModelId(modelId, settings.customProviders ?? [])
    })
  }

  async setYolo(subchatId: string, yolo: boolean): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'setYolo', yolo })
  }

  async setThinking(subchatId: string, level: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'setThinking', level })
  }

  async newThread(subchatId: string): Promise<{ threadId: string }> {
    const handle = await this.ensureHost(subchatId)
    const res = await this.request<{ threadId: string }>(handle, {
      t: 'newThread',
      reqId: randomUUID()
    })
    this.bindThread(subchatId, handle, res.threadId)
    return res
  }

  /** Persist the subchat↔thread binding and broadcast fresh session meta. */
  private bindThread(subchatId: string, handle: HostHandle, threadId: string | null): void {
    handle.meta.threadId = threadId ?? undefined
    getDb()
      .update(schema.subchats)
      .set({ mastraThreadId: threadId })
      .where(eq(schema.subchats.id, subchatId))
      .run()
    this.emitUI(subchatId, { type: 'session-meta', meta: { ...handle.meta } })
  }

  /** Insert a transcript marker (thread switches interleave histories). */
  private insertMarker(subchatId: string, text: string): void {
    const marker: StoredMessage = {
      id: randomUUID(),
      role: 'assistant',
      parts: [{ type: 'info', level: 'info', text }],
      createdAt: Date.now()
    }
    this.persistMessage(subchatId, marker, true)
    this.emitUI(subchatId, { type: 'message-upsert', message: marker })
  }

  async listThreads(subchatId: string): Promise<ThreadInfo[]> {
    const handle = await this.ensureHost(subchatId)
    return this.request<ThreadInfo[]>(handle, { t: 'threadList', reqId: randomUUID() })
  }

  async switchThread(subchatId: string, threadId: string): Promise<{ threadId: string }> {
    const handle = await this.ensureHost(subchatId)
    const res = await this.request<{ threadId: string | null }>(handle, {
      t: 'threadSwitch',
      reqId: randomUUID(),
      threadId
    })
    this.bindThread(subchatId, handle, res.threadId)
    this.insertMarker(subchatId, `Switched to thread ${res.threadId ?? threadId}`)
    return { threadId: res.threadId ?? threadId }
  }

  /** Renames the session's active thread (SDK constraint). */
  async renameThread(subchatId: string, title: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    await this.request(handle, { t: 'threadRename', reqId: randomUUID(), title })
  }

  async cloneThread(
    subchatId: string,
    sourceThreadId?: string,
    title?: string
  ): Promise<{ threadId: string }> {
    const handle = await this.ensureHost(subchatId)
    const res = await this.request<{ threadId: string }>(handle, {
      t: 'threadClone',
      reqId: randomUUID(),
      sourceThreadId,
      title
    })
    this.bindThread(subchatId, handle, res.threadId)
    this.insertMarker(subchatId, `Cloned into new thread ${res.threadId}`)
    return res
  }

  /**
   * Rollback support: delete the agent's memory of everything after the
   * anchor (last surviving assistant message). The revert note itself is
   * stored on the subchat and delivered with the next message send.
   */
  async rewindThread(subchatId: string, anchorMessageId: string): Promise<{ deleted: number }> {
    const handle = await this.ensureHost(subchatId)
    return this.request<{ deleted: number }>(handle, {
      t: 'rewindThread',
      reqId: randomUUID(),
      anchorMessageId
    })
  }

  async deleteThread(subchatId: string, threadId: string): Promise<{ threadId: string }> {
    const handle = await this.ensureHost(subchatId)
    const res = await this.request<{ threadId: string | null }>(handle, {
      t: 'threadDelete',
      reqId: randomUUID(),
      threadId
    })
    this.bindThread(subchatId, handle, res.threadId)
    return { threadId: res.threadId ?? '' }
  }

  /** Current tool-permission rules + session grants. */
  async getPermissions(subchatId: string): Promise<PermissionsSnapshot> {
    const handle = await this.ensureHost(subchatId)
    return this.request<PermissionsSnapshot>(handle, { t: 'getPermissions', reqId: randomUUID() })
  }

  async setPermission(
    subchatId: string,
    scope: 'tool' | 'category',
    name: string,
    policy: PermissionPolicy
  ): Promise<PermissionsSnapshot> {
    const handle = await this.ensureHost(subchatId)
    return this.request<PermissionsSnapshot>(handle, {
      t: 'setPermission',
      reqId: randomUUID(),
      scope,
      name,
      policy
    })
  }

  /** The active thread's durable goal objective, or null. */
  async goalGet(subchatId: string): Promise<GoalInfo | null> {
    const handle = await this.ensureHost(subchatId)
    return this.request<GoalInfo | null>(handle, { t: 'goalGet', reqId: randomUUID() })
  }

  async goalSet(
    subchatId: string,
    objective: string,
    judgeModelId?: string,
    maxRuns?: number
  ): Promise<GoalInfo | null> {
    const handle = await this.ensureHost(subchatId)
    const goal = await this.request<GoalInfo | null>(handle, {
      t: 'goalSet',
      reqId: randomUUID(),
      objective,
      judgeModelId,
      maxRuns
    })
    this.insertMarker(subchatId, `Goal set: ${objective}`)
    return goal
  }

  async goalClear(subchatId: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    await this.request<null>(handle, { t: 'goalClear', reqId: randomUUID() })
    this.insertMarker(subchatId, 'Goal cleared')
  }

  /** Adjust judge/max-runs or pause/resume the existing goal. */
  async goalUpdate(
    subchatId: string,
    patch: { judgeModelId?: string; maxRuns?: number; status?: 'active' | 'paused' }
  ): Promise<GoalInfo | null> {
    const handle = await this.ensureHost(subchatId)
    const goal = await this.request<GoalInfo | null>(handle, {
      t: 'goalUpdate',
      reqId: randomUUID(),
      ...patch
    })
    // Markers only for status changes; config tweaks stay silent (omSet precedent).
    if (patch.status && goal) {
      this.insertMarker(subchatId, patch.status === 'paused' ? 'Goal paused' : 'Goal resumed')
    }
    return goal
  }

  /** Observational Memory runtime config from live session state. */
  async omGet(subchatId: string): Promise<OmRuntimeInfo> {
    const handle = await this.ensureHost(subchatId)
    return this.request<OmRuntimeInfo>(handle, { t: 'omGet', reqId: randomUUID() })
  }

  async omSet(subchatId: string, patch: OmRuntimePatch): Promise<OmRuntimeInfo> {
    const handle = await this.ensureHost(subchatId)
    return this.request<OmRuntimeInfo>(handle, { t: 'omSet', reqId: randomUUID(), patch })
  }

  /** Custom .md slash commands discovered for the subchat's cwd. */
  async listCommands(subchatId: string): Promise<SlashCommandInfo[]> {
    const handle = await this.ensureHost(subchatId)
    return this.request<SlashCommandInfo[]>(handle, { t: 'listCommands', reqId: randomUUID() })
  }

  /** Expand a custom command and send it; transcript shows `/name args`. */
  async runCommand(
    subchatId: string,
    name: string,
    args: string,
    checkpointRef?: string
  ): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    const { prompt } = await this.request<{ prompt: string }>(handle, {
      t: 'expandCommand',
      reqId: randomUUID(),
      name,
      args
    })
    const display = `/${name}${args.trim() ? ` ${args.trim()}` : ''}`
    await this.sendMessage(subchatId, prompt, checkpointRef, display)
  }

  /** Re-read global + project hooks.json in the live host. */
  async reloadHooks(subchatId: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    await this.request<null>(handle, { t: 'reloadHooks', reqId: randomUUID() })
  }

  /** The live session's memory resource id. */
  async resourceInfo(subchatId: string): Promise<ResourceInfo> {
    const handle = await this.ensureHost(subchatId)
    return this.request<ResourceInfo>(handle, { t: 'resourceInfo', reqId: randomUUID() })
  }

  /** Session-state keys surfaced to the UI (notifications, smartEditing, sandbox paths). */
  async stateGet(subchatId: string): Promise<SessionStateInfo> {
    const handle = await this.ensureHost(subchatId)
    return this.request<SessionStateInfo>(handle, { t: 'stateGet', reqId: randomUUID() })
  }

  async stateSet(subchatId: string, patch: SessionStatePatch): Promise<SessionStateInfo> {
    const handle = await this.ensureHost(subchatId)
    return this.request<SessionStateInfo>(handle, { t: 'stateSet', reqId: randomUUID(), patch })
  }

  /** User-invocable workspace skills (SKILL.md) for the subchat's cwd. */
  async listSkills(subchatId: string): Promise<SkillInfo[]> {
    const handle = await this.ensureHost(subchatId)
    return this.request<SkillInfo[]>(handle, { t: 'listSkills', reqId: randomUUID() })
  }

  /** Activate a skill and send it; transcript shows `/skill name args`. */
  async runSkill(
    subchatId: string,
    name: string,
    args: string,
    checkpointRef?: string
  ): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    const { display, prompt } = await this.request<{ display: string; prompt: string }>(handle, {
      t: 'runSkill',
      reqId: randomUUID(),
      name,
      args
    })
    await this.sendMessage(subchatId, prompt, checkpointRef, display)
  }

  /** Plugins/skills loaded by the subchat's host. */
  async listPlugins(subchatId: string): Promise<PluginInfo[]> {
    const handle = await this.ensureHost(subchatId)
    return this.request<PluginInfo[]>(handle, { t: 'listPlugins', reqId: randomUUID() })
  }

  /** Install a plugin; runs on the subchat's host so 'project' scope hits its cwd. */
  async pluginInstall(
    subchatId: string,
    source: 'local' | 'github',
    pathOrUrl: string,
    scope: PluginScope
  ): Promise<PluginInfo[]> {
    const handle = await this.ensureHost(subchatId)
    // GitHub installs clone a repo — allow well beyond the default timeout.
    return this.request<PluginInfo[]>(
      handle,
      { t: 'pluginInstall', reqId: randomUUID(), source, pathOrUrl, scope },
      5 * 60_000
    )
  }

  async pluginUninstall(
    subchatId: string,
    pluginId: string,
    scope: PluginScope
  ): Promise<PluginInfo[]> {
    const handle = await this.ensureHost(subchatId)
    return this.request<PluginInfo[]>(handle, {
      t: 'pluginUninstall',
      reqId: randomUUID(),
      pluginId,
      scope
    })
  }

  async pluginSetEnabled(
    subchatId: string,
    pluginId: string,
    scope: PluginScope,
    enabled: boolean
  ): Promise<PluginInfo[]> {
    const handle = await this.ensureHost(subchatId)
    return this.request<PluginInfo[]>(handle, {
      t: 'pluginSetEnabled',
      reqId: randomUUID(),
      pluginId,
      scope,
      enabled
    })
  }

  async pluginSetConfig(
    subchatId: string,
    pluginId: string,
    scope: PluginScope,
    key: string,
    value: string | boolean
  ): Promise<PluginInfo[]> {
    const handle = await this.ensureHost(subchatId)
    return this.request<PluginInfo[]>(handle, {
      t: 'pluginSetConfig',
      reqId: randomUUID(),
      pluginId,
      scope,
      key,
      value
    })
  }

  /** Built-in + custom model packs and OM packs, filtered by provider access. */
  async listPacks(): Promise<PacksInfo> {
    const handle = await this.ensureUtilityHost()
    return this.request<PacksInfo>(handle, { t: 'listPacks', reqId: randomUUID() })
  }

  /** The SDK's speech-to-text model registry (voice settings picker). */
  async sttRegistry(): Promise<SttModelInfo[]> {
    const handle = await this.ensureUtilityHost()
    return this.request<SttModelInfo[]>(handle, { t: 'sttRegistry', reqId: randomUUID() })
  }

  /** Cloud STT — runs in the shared utility host; independent of any agent run. */
  async transcribe(input: {
    audioBase64: string
    mimeType: string
    provider?: string
    model?: string
  }): Promise<{ text: string }> {
    const handle = await this.ensureUtilityHost()
    // Long timeout: cloud transcription of a multi-minute clip can take a while.
    return this.request<{ text: string }>(
      handle,
      { t: 'transcribe', reqId: randomUUID(), ...input },
      120_000
    )
  }

  async listModels(subchatId?: string): Promise<ModelInfo[]> {
    const handle = subchatId ? await this.ensureHost(subchatId) : await this.ensureUtilityHost()
    const models = await this.request<ModelInfo[]>(handle, { t: 'listModels', reqId: randomUUID() })
    // The SDK's catalog emits gateway-prefixed ids its own resolver can't parse,
    // and marks keyless custom providers (local Ollama etc.) as unusable even
    // though it runs them keyless — normalize both from settings.json.
    const settings = await readSettings()
    return normalizeCustomProviderModels(models, settings.customProviders ?? [])
  }

  async authList(): Promise<AuthEntry[]> {
    const handle = await this.ensureUtilityHost()
    return this.request<AuthEntry[]>(handle, { t: 'authList', reqId: randomUUID() })
  }

  async authSet(provider: string, apiKey: string): Promise<void> {
    const handle = await this.ensureUtilityHost()
    await this.request(handle, { t: 'authSet', reqId: randomUUID(), provider, key: apiKey })
    await this.broadcastAuthReload(handle)
  }

  async authRemove(provider: string): Promise<void> {
    const handle = await this.ensureUtilityHost()
    await this.request(handle, { t: 'authRemove', reqId: randomUUID(), provider })
    await this.broadcastAuthReload(handle)
  }

  /**
   * Credentials changed on one host — tell every other live host to re-read
   * auth.json and drop its model-catalog cache, so hasApiKey is correct
   * everywhere without a restart. Best-effort: failures are ignored.
   */
  private async broadcastAuthReload(exclude?: HostHandle): Promise<void> {
    const handles = new Set<HostHandle>(this.hosts.values())
    if (this.utilityHost) handles.add(this.utilityHost)
    await Promise.all(
      [...handles]
        .filter((h) => h !== exclude && !h.killed && h.status === 'ready')
        .map((h) => this.request(h, { t: 'authReload', reqId: randomUUID() }).catch(() => {}))
    )
  }

  // ---- OAuth login flows ---------------------------------------------------

  private oauthEmitter = new EventEmitter()
  /** Which host each in-flight OAuth flow runs on (for prompt/cancel routing). */
  private oauthHandles = new Map<string, HostHandle>()

  onOauthStatus(listener: (ev: OAuthStatusEvent) => void): () => void {
    this.oauthEmitter.on('status', listener)
    return () => this.oauthEmitter.off('status', listener)
  }

  private relayOauthStatus(ev: OAuthStatusEvent): void {
    // Open the provider's auth page for the user; the event still carries the
    // URL so the renderer can offer an "open again" link. Only http(s) URLs —
    // never hand other schemes (file:, app protocols) to the OS.
    if (ev.kind === 'auth-url' && ev.url && /^https?:\/\//i.test(ev.url)) {
      shell.openExternal(ev.url).catch(() => {})
    }
    this.oauthEmitter.emit('status', ev)
  }

  async oauthProviders(): Promise<OAuthProviderInfo[]> {
    const handle = await this.ensureUtilityHost()
    return this.request<OAuthProviderInfo[]>(handle, { t: 'oauthProviders', reqId: randomUUID() })
  }

  /**
   * Start an OAuth login. Returns the flow id immediately; progress and the
   * final done/error arrive via onOauthStatus.
   */
  async oauthStart(provider: string, authMode?: string): Promise<{ flowId: string }> {
    const handle = await this.ensureUtilityHost()
    const flowId = randomUUID()
    this.oauthHandles.set(flowId, handle)
    this.request<{ loggedIn: boolean }>(
      handle,
      { t: 'oauthLogin', reqId: flowId, provider, authMode },
      10 * 60_000 // user completes the flow in a browser
    )
      .then(async (res) => {
        if (res.loggedIn) await this.broadcastAuthReload(handle)
        this.relayOauthStatus({
          flowId,
          kind: res.loggedIn ? 'done' : 'error',
          message: res.loggedIn ? `Logged in to ${provider}` : 'Login did not complete'
        })
      })
      .catch((err: unknown) => {
        this.relayOauthStatus({
          flowId,
          kind: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
      .finally(() => {
        this.oauthHandles.delete(flowId)
      })
    return { flowId }
  }

  oauthPrompt(flowId: string, value: string): void {
    const handle = this.oauthHandles.get(flowId)
    if (handle && !handle.killed) {
      this.sendCommand(handle, { t: 'oauthPrompt', reqId: flowId, value })
    }
  }

  oauthCancel(flowId: string): void {
    const handle = this.oauthHandles.get(flowId)
    if (handle && !handle.killed) {
      this.sendCommand(handle, { t: 'oauthCancel', reqId: flowId })
    }
  }

  async oauthLogout(provider: string): Promise<void> {
    const handle = await this.ensureUtilityHost()
    await this.request(handle, { t: 'oauthLogout', reqId: randomUUID(), provider })
    await this.broadcastAuthReload(handle)
  }

  /** Stop the host for a subchat (e.g. on chat delete or app quit). */
  stopHost(subchatId: string): void {
    this.clearIdeNoteTimer(subchatId)
    this.writeBuffer.flush(subchatId)
    const handle = this.hosts.get(subchatId)
    if (!handle) return
    try {
      this.sendCommand(handle, { t: 'shutdown' })
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (!handle.killed) handle.proc.kill()
    }, 2000)
    this.hosts.delete(subchatId)
  }

  /**
   * Stop a subchat's host and wait until the process has actually exited, so
   * callers can safely rewrite its working tree (e.g. snapshot rollback).
   * Never hangs: resolves after timeoutMs even if the exit event is lost.
   */
  async stopHostAndWait(subchatId: string, timeoutMs = 3000): Promise<void> {
    this.clearIdeNoteTimer(subchatId)
    this.writeBuffer.flush(subchatId)
    const handle = this.hosts.get(subchatId)
    this.hosts.delete(subchatId)
    if (!handle || handle.killed) return

    const exited = new Promise<void>((resolve) => {
      handle.proc.once('exit', () => resolve())
    })
    try {
      this.sendCommand(handle, { t: 'shutdown' })
    } catch {
      // ignore — the kill below covers it
    }
    // Escalate to a hard kill before the outer timeout gives up on waiting.
    setTimeout(
      () => {
        if (!handle.killed) handle.proc.kill()
      },
      Math.max(500, timeoutMs - 1000)
    )
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
  }

  /** Restart hosts (e.g. after mcp.json change). */
  restartAll(): void {
    for (const id of [...this.hosts.keys()]) this.stopHost(id)
    if (this.utilityHost) {
      const h = this.utilityHost
      this.utilityHost = null
      try {
        h.proc.postMessage({ t: 'shutdown' } satisfies HostCommand)
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (!h.killed) h.proc.kill()
      }, 2000)
    }
  }

  /**
   * Restart only the hosts whose subchats belong to the given project (its
   * worktrees included). Falls back to stopping when the lookup fails.
   */
  restartByProject(projectPath: string): void {
    const db = getDb()
    for (const subchatId of [...this.hosts.keys()]) {
      const subchat = db
        .select({ chatId: schema.subchats.chatId })
        .from(schema.subchats)
        .where(eq(schema.subchats.id, subchatId))
        .get()
      const chat = subchat
        ? db
            .select({ projectId: schema.chats.projectId })
            .from(schema.chats)
            .where(eq(schema.chats.id, subchat.chatId))
            .get()
        : undefined
      const project = chat
        ? db
            .select({ path: schema.projects.path })
            .from(schema.projects)
            .where(eq(schema.projects.id, chat.projectId))
            .get()
        : undefined
      if (!project || project.path === projectPath) this.stopHost(subchatId)
    }
  }

  shutdownAll(): void {
    this.writeBuffer.flush()
    this.restartAll()
  }

  /**
   * Verify the bundled mastracode runtime can actually boot by ensuring the
   * utility host is up. Cheap when a host is already running.
   */
  async preflight(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureUtilityHost()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: this.lastBootError ?? message }
    }
  }

  /** Host used only for auth/model queries; cwd = home dir, never runs the agent. */
  private async ensureUtilityHost(): Promise<HostHandle> {
    // Prefer any live chat host to avoid an extra process.
    for (const handle of this.hosts.values()) {
      if (!handle.killed && handle.status === 'ready') return handle
    }
    if (this.utilityHost && !this.utilityHost.killed) {
      await this.utilityHost.readyPromise
      return this.utilityHost
    }
    const boot: HostBootConfig = { cwd: os.homedir(), yolo: false }
    const handle = this.spawnHost('__utility__', boot)
    this.utilityHost = handle
    handle.proc.on('exit', () => {
      if (this.utilityHost === handle) this.utilityHost = null
    })
    await handle.readyPromise
    return handle
  }
}

export const agentSessionManager = new AgentSessionManager()
