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
import { EventTranslator } from './event-translator'
import { clampMessageForStorage } from './message-clamp'
import type {
  AgentControllerEventLike,
  AuthEntry,
  FileAttachment,
  GoalInfo,
  HostBootConfig,
  HostCommand,
  HostMessage,
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
import type { AgentStatus, AgentUIEvent, StoredMessage, TaskItem } from '../../../shared/ui-message'

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
  /** Most recent boot-error from any host; cleared when a host boots cleanly. */
  private lastBootError: string | null = null

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
      .reverse()
    return rows.map((r) => ({
      id: r.id,
      role: r.role as StoredMessage['role'],
      parts: JSON.parse(r.parts) as StoredMessage['parts'],
      usage: r.usage ? (JSON.parse(r.usage) as StoredMessage['usage']) : undefined,
      checkpointRef: r.checkpointRef,
      createdAt: r.createdAt
    }))
  }

  private persistMessage(subchatId: string, rawMessage: StoredMessage): void {
    // Clamp oversized tool payloads before they hit disk.
    const message = clampMessageForStorage(rawMessage)
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
      const maxSeq =
        db
          .select({ max: sql<number | null>`max(${schema.messages.seq})` })
          .from(schema.messages)
          .where(eq(schema.messages.subchatId, subchatId))
          .get()?.max ?? 0
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
          this.lastBootError = null
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
    this.persistMessage(subchatId, userMessage)
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
    this.recordUserMessage(subchatId, (displayText ?? content) + attachmentNote, checkpointRef)
    this.sendCommand(handle, { t: 'send', text: content, files })
  }

  /**
   * Queue a message to run after the active run finishes (Session.followUp);
   * sends immediately when the session is idle. No files support (SDK limit).
   */
  async followUp(subchatId: string, content: string, checkpointRef?: string): Promise<void> {
    const handle = await this.ensureHost(subchatId)
    this.recordUserMessage(subchatId, content, checkpointRef)
    this.sendCommand(handle, { t: 'followUp', text: content })
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
    this.persistMessage(subchatId, marker)
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
      .then((res) => {
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
