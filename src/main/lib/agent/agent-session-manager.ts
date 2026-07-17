/**
 * Manages one agent host (Electron utilityProcess running mastracode) per
 * subchat. Translates host events into AgentUIEvents, persists messages,
 * and exposes request/response commands to the tRPC layer.
 */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { eq, asc } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { EventTranslator } from './event-translator'
import type {
  AgentControllerEventLike,
  AuthEntry,
  HostBootConfig,
  HostCommand,
  HostMessage,
  ModelInfo
} from '../../../shared/ipc-types'
import type { AgentStatus, AgentUIEvent, StoredMessage } from '../../../shared/ui-message'

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
  meta: { threadId?: string; mode?: string; modelId?: string; yolo?: boolean; thinkingLevel?: string }
  readyPromise: Promise<void>
  readyResolve: () => void
  readyReject: (err: Error) => void
  killed: boolean
}

const REQUEST_TIMEOUT_MS = 30_000

export class AgentSessionManager {
  private hosts = new Map<string, HostHandle>()
  private emitters = new Map<string, EventEmitter>()
  /** A host with cwd=$HOME used for auth/model queries when no chat host exists. */
  private utilityHost: HostHandle | null = null

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
  }

  onEvents(subchatId: string, listener: (ev: AgentUIEvent) => void): () => void {
    const em = this.emitterFor(subchatId)
    em.on('event', listener)
    return () => em.off('event', listener)
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
    const db = getDb()
    const rows = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.subchatId, subchatId))
      .orderBy(asc(schema.messages.seq))
      .all()
    return rows.map((r) => ({
      id: r.id,
      role: r.role as StoredMessage['role'],
      parts: JSON.parse(r.parts) as StoredMessage['parts'],
      usage: r.usage ? (JSON.parse(r.usage) as StoredMessage['usage']) : undefined,
      checkpointRef: r.checkpointRef,
      createdAt: r.createdAt
    }))
  }

  private persistMessage(subchatId: string, message: StoredMessage): void {
    const db = getDb()
    const existing = db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.id, message.id))
      .get()
    if (existing) {
      db.update(schema.messages)
        .set({
          parts: JSON.stringify(message.parts),
          usage: message.usage ? JSON.stringify(message.usage) : null
        })
        .where(eq(schema.messages.id, message.id))
        .run()
    } else {
      const maxSeq = db
        .select({ seq: schema.messages.seq })
        .from(schema.messages)
        .where(eq(schema.messages.subchatId, subchatId))
        .orderBy(asc(schema.messages.seq))
        .all()
        .reduce((m, r) => Math.max(m, r.seq), 0)
      db.insert(schema.messages)
        .values({
          id: message.id,
          subchatId,
          role: message.role,
          parts: JSON.stringify(message.parts),
          usage: message.usage ? JSON.stringify(message.usage) : null,
          checkpointRef: message.checkpointRef ?? null,
          seq: maxSeq + 1,
          createdAt: message.createdAt
        })
        .run()
    }
  }

  /** Ensure a host process exists for the subchat; boots one if needed. */
  async ensureHost(subchatId: string): Promise<HostHandle> {
    const existing = this.hosts.get(subchatId)
    if (existing && !existing.killed) {
      await existing.readyPromise
      return existing
    }

    const db = getDb()
    const subchat = db
      .select()
      .from(schema.subchats)
      .where(eq(schema.subchats.id, subchatId))
      .get()
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
    const boot: HostBootConfig = {
      cwd,
      threadId: subchat.mastraThreadId ?? undefined,
      mode: subchat.mode ?? undefined,
      modelId: subchat.modelId ?? undefined,
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
    const proc = utilityProcess.fork(HOST_ENTRY, [], {
      serviceName: `codezero-agent-${subchatId}`,
      stdio: 'pipe',
      env: {
        ...process.env,
        CODEZERO_BOOT: JSON.stringify(boot)
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

    const translator = new EventTranslator({
      emit: (ev) => this.emitUI(subchatId, ev),
      persistMessage: (m) => this.persistMessage(subchatId, m),
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
      onRunStateChanged: () => {}
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
          handle.status = 'ready'
          handle.meta = {
            threadId: msg.threadId ?? undefined,
            mode: msg.mode,
            modelId: msg.modelId,
            yolo: (msg.state as Record<string, unknown> | undefined)?.yolo as boolean | undefined,
            thinkingLevel: (msg.state as Record<string, unknown> | undefined)?.thinkingLevel as
              | string
              | undefined
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
        case 'log':
          console.log(`[agent-host ${subchatId}]`, msg.msg)
          break
      }
    })

    proc.on('exit', (code) => {
      handle.killed = true
      handle.status = 'stopped'
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

  private request<T>(handle: HostHandle, cmd: HostCommand & { reqId: string }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        handle.pending.delete(cmd.reqId)
        reject(new Error(`Agent host request timed out: ${cmd.t}`))
      }, REQUEST_TIMEOUT_MS)
      handle.pending.set(cmd.reqId, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer
      })
      handle.proc.postMessage(cmd)
    })
  }

  // ---- Public command surface -------------------------------------------

  async sendMessage(subchatId: string, content: string, checkpointRef?: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    // Persist + broadcast the user message immediately.
    const userMessage: StoredMessage = {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: content }],
      checkpointRef: checkpointRef ?? null,
      createdAt: Date.now()
    }
    this.persistMessage(subchatId, userMessage)
    this.emitUI(subchatId, { type: 'message-upsert', message: userMessage })
    this.sendCommand(handle, { t: 'send', text: content })
    // Touch chat updatedAt
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

  async respondSuspension(subchatId: string, toolCallId: string, resumeData: unknown): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'suspension', toolCallId, resumeData })
  }

  abort(subchatId: string): void {
    const handle = this.hosts.get(subchatId)
    if (handle && !handle.killed) this.sendCommand(handle, { t: 'abort' })
  }

  async setMode(subchatId: string, modeId: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'setMode', mode: modeId })
  }

  async setModel(subchatId: string, modelId: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'setModel', modelId })
  }

  async setYolo(subchatId: string, yolo: boolean): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'setYolo', yolo })
  }

  async setThinking(subchatId: string, level: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.sendCommand(handle, { t: 'setThinking', level })
  }

  async listModels(subchatId?: string): Promise<ModelInfo[]> {
    const handle = subchatId ? await this.ensureHost(subchatId) : await this.ensureUtilityHost()
    return this.request<ModelInfo[]>(handle, { t: 'listModels', reqId: randomUUID() })
  }

  async authList(): Promise<AuthEntry[]> {
    const handle = await this.ensureUtilityHost()
    return this.request<AuthEntry[]>(handle, { t: 'authList', reqId: randomUUID() })
  }

  async authSet(provider: string, apiKey: string): Promise<void> {
    const handle = await this.ensureUtilityHost()
    await this.request(handle, { t: 'authSet', reqId: randomUUID(), provider, key: apiKey })
  }

  async authRemove(provider: string): Promise<void> {
    const handle = await this.ensureUtilityHost()
    await this.request(handle, { t: 'authRemove', reqId: randomUUID(), provider })
  }

  /** Stop the host for a subchat (e.g. on chat delete or app quit). */
  stopHost(subchatId: string): void {
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

  shutdownAll(): void {
    this.restartAll()
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
