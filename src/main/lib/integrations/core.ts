/**
 * Platform-agnostic core for remote messaging integrations: routes inbound
 * messages (allowlist → commands → prompts), relays tool approvals and agent
 * questions to bound conversations, and delivers final assistant replies on
 * run-finished. Rides entirely on agentSessionManager — no agent-host/SDK
 * changes. Bindings are re-read from the DB at dispatch time so deleted
 * chats (cascade) degrade to a "nothing bound" hint instead of stale sends.
 */
import { agentSessionManager } from '../agent/agent-session-manager'
import { createChatWithSubchat } from '../agent/chat-factory'
import type { IntegrationPlatform } from '../../../shared/integrations'
import type { AgentUIEvent, PendingApproval, PendingSuspension } from '../../../shared/ui-message'
import type { InboundMessage } from './types'
import { HELP_TEXT, parseCommand, pickPending, type Command } from './commands'
import { chunkMessage } from './chunk'
import {
  compactArgs,
  extractFinalText,
  formatApprovalMessage,
  formatForPlatform,
  formatQuestionMessage
} from './format'
import {
  allBoundSubchatIds,
  bindingsForSubchat,
  deleteBindingByConversation,
  firstSubchatId,
  getBinding,
  listChats,
  listProjects,
  resolveByName,
  setBinding,
  type BindingRow
} from './bindings'

export interface CoreDeps {
  /** Allowlist check from the live config (default deny). */
  isAllowed(platform: IntegrationPlatform, userId: string): boolean
  /** Raw platform send (text must already fit the platform limit). */
  send(platform: IntegrationPlatform, conversationId: string, text: string): Promise<void>
  maxMessageLength(platform: IntegrationPlatform): number
}

const DEDUPE_CAP = 500
const PLATFORM_LABEL: Record<IntegrationPlatform, string> = {
  slack: 'Slack',
  discord: 'Discord'
}

const NO_BINDING_HINT =
  'No chat is bound to this conversation yet. Send "projects" to list projects, then ' +
  '"use <project> <chat>" or "new <project> [title]". Send "help" for all commands.'

export class IntegrationsCore {
  /** LRU-ish set of `platform:messageId` for duplicate-delivery suppression. */
  private seen = new Set<string>()
  /** platform:conversation:user keys already told they are not allowed. */
  private deniedNotified = new Set<string>()
  /** Targeted onEvents subscriptions, bound subchats only. */
  private subscriptions = new Map<string, () => void>()
  /** Relayed-but-unresolved approval/suspension tool calls, per subchat. */
  private relayed = new Map<string, Set<string>>()
  /** Tool calls resolved from a remote conversation (skip the in-app echo). */
  private resolvedRemotely = new Set<string>()

  constructor(private deps: CoreDeps) {}

  // ---- Outbound plumbing -----------------------------------------------------

  /** Format for the platform, chunk to its limit, send best-effort. */
  private async deliver(
    platform: IntegrationPlatform,
    conversationId: string,
    text: string
  ): Promise<void> {
    const formatted = formatForPlatform(text, platform)
    for (const chunk of chunkMessage(formatted, this.deps.maxMessageLength(platform))) {
      await this.deps.send(platform, conversationId, chunk)
    }
  }

  /** Deliver to every conversation bound to a subchat; prune when none left. */
  private async fanOut(subchatId: string, text: string): Promise<void> {
    const bindings = bindingsForSubchat(subchatId)
    if (bindings.length === 0) {
      this.unsubscribe(subchatId)
      return
    }
    for (const b of bindings) {
      try {
        await this.deliver(b.platform as IntegrationPlatform, b.conversationId, text)
      } catch (err) {
        console.error('[integrations] send failed', b.platform, err)
      }
    }
  }

  // ---- Relay subscriptions ---------------------------------------------------

  private unsubscribe(subchatId: string): void {
    this.subscriptions.get(subchatId)?.()
    this.subscriptions.delete(subchatId)
    this.relayed.delete(subchatId)
  }

  ensureSubscribed(subchatId: string): void {
    if (this.subscriptions.has(subchatId)) return
    const off = agentSessionManager.onEvents(subchatId, (ev) => {
      void this.onAgentEvent(subchatId, ev).catch((err) =>
        console.error('[integrations] relay failed', err)
      )
    })
    this.subscriptions.set(subchatId, off)
  }

  /** Reconcile subscriptions with the bindings table (start + mutations). */
  rebuildSubscriptions(): void {
    let bound: string[]
    try {
      bound = allBoundSubchatIds()
    } catch {
      return // DB closed during shutdown
    }
    const want = new Set(bound)
    for (const subchatId of [...this.subscriptions.keys()]) {
      if (!want.has(subchatId)) this.unsubscribe(subchatId)
    }
    for (const subchatId of want) this.ensureSubscribed(subchatId)
  }

  dispose(): void {
    for (const off of this.subscriptions.values()) off()
    this.subscriptions.clear()
    this.relayed.clear()
  }

  private relayedFor(subchatId: string): Set<string> {
    let set = this.relayed.get(subchatId)
    if (!set) {
      set = new Set()
      this.relayed.set(subchatId, set)
    }
    return set
  }

  private async onAgentEvent(subchatId: string, ev: AgentUIEvent): Promise<void> {
    switch (ev.type) {
      case 'run-finished': {
        const text = extractFinalText(agentSessionManager.loadMessages(subchatId))
        await this.fanOut(subchatId, text || 'Run finished (no text reply).')
        return
      }
      case 'approval-request': {
        this.relayedFor(subchatId).add(ev.approval.toolCallId)
        await this.fanOut(subchatId, formatApprovalMessage(ev.approval.toolName, ev.approval.args))
        return
      }
      case 'suspension-request': {
        const s = ev.suspension
        this.relayedFor(subchatId).add(s.toolCallId)
        if (s.toolName === 'ask_user') {
          await this.fanOut(subchatId, formatQuestionMessage(s.suspendPayload ?? s.args))
        } else {
          await this.fanOut(
            subchatId,
            `The agent is waiting on ${s.toolName} — handle it in the Yardarm app.`
          )
        }
        return
      }
      case 'approval-resolved':
      case 'suspension-resolved': {
        const set = this.relayedFor(subchatId)
        if (!set.delete(ev.toolCallId)) return
        if (this.resolvedRemotely.delete(ev.toolCallId)) return
        await this.fanOut(subchatId, 'Handled in the app.')
        return
      }
    }
  }

  // ---- Inbound ---------------------------------------------------------------

  async handleInbound(msg: InboundMessage): Promise<void> {
    if (msg.messageId) {
      const key = `${msg.platform}:${msg.messageId}`
      if (this.seen.has(key)) return
      this.seen.add(key)
      if (this.seen.size > DEDUPE_CAP) {
        const oldest = this.seen.values().next().value
        if (oldest) this.seen.delete(oldest)
      }
    }

    const reply = (text: string): Promise<void> =>
      this.deliver(msg.platform, msg.conversationId, text)

    if (!this.deps.isAllowed(msg.platform, msg.userId)) {
      // Say it once per user per conversation, then stay silent: in a shared
      // channel the bot would otherwise answer every message from everyone.
      const key = `${msg.platform}:${msg.conversationId}:${msg.userId}`
      if (this.deniedNotified.has(key)) return
      this.deniedNotified.add(key)
      if (this.deniedNotified.size > DEDUPE_CAP) {
        const oldest = this.deniedNotified.values().next().value
        if (oldest) this.deniedNotified.delete(oldest)
      }
      await reply(
        `Access denied: user ${msg.userId} is not on the ${PLATFORM_LABEL[msg.platform]} ` +
          'allowlist. Add this id in Yardarm under Settings → Integrations.'
      )
      return
    }

    const command = parseCommand(msg.text)
    try {
      await this.execute(command, msg, reply)
    } catch (err) {
      await reply(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async execute(
    command: Command,
    msg: InboundMessage,
    reply: (text: string) => Promise<void>
  ): Promise<void> {
    switch (command.kind) {
      case 'help':
        await reply(HELP_TEXT)
        return
      case 'projects': {
        const projects = listProjects()
        await reply(
          projects.length === 0
            ? 'No projects yet. Add one in the Yardarm app first.'
            : projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n')
        )
        return
      }
      case 'chats': {
        const project = resolveByName(listProjects(), command.project, 'project')
        if ('error' in project) return reply(project.error)
        const chats = listChats(project.ok.id)
        await reply(
          chats.length === 0
            ? `No chats in ${project.ok.name} yet. Use "new ${project.ok.name}" to create one.`
            : `Chats in ${project.ok.name}:\n` +
                chats.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
        )
        return
      }
      case 'use': {
        const project = resolveByName(listProjects(), command.project, 'project')
        if ('error' in project) return reply(project.error)
        const chat = resolveByName(listChats(project.ok.id), command.chat, 'chat')
        if ('error' in chat) return reply(chat.error)
        const subchatId = firstSubchatId(chat.ok.id)
        if (!subchatId) return reply(`Chat "${chat.ok.name}" has no conversation to bind to.`)
        setBinding({
          platform: msg.platform,
          conversationId: msg.conversationId,
          projectId: project.ok.id,
          chatId: chat.ok.id,
          subchatId
        })
        this.rebuildSubscriptions()
        await reply(
          `Bound to ${project.ok.name} / ${chat.ok.name}. Messages here now go to that chat.`
        )
        return
      }
      case 'new': {
        const project = resolveByName(listProjects(), command.project, 'project')
        if ('error' in project) return reply(project.error)
        const title = command.title?.trim() || `Remote: ${PLATFORM_LABEL[msg.platform]}`
        const created = await createChatWithSubchat({
          projectId: project.ok.id,
          title,
          useWorktree: true
        })
        setBinding({
          platform: msg.platform,
          conversationId: msg.conversationId,
          projectId: project.ok.id,
          chatId: created.id,
          subchatId: created.subchats[0].id
        })
        this.rebuildSubscriptions()
        await reply(
          `Created "${title}" in ${project.ok.name} and bound this conversation to it.` +
            (created.pendingSetupCommands.length > 0 || created.pendingCopyFiles.length > 0
              ? ' Its worktree setup (commands and files to copy) was skipped because it has not been approved — approve it in the Yardarm app (Project Settings).'
              : '')
        )
        return
      }
      case 'status': {
        const binding = getBinding(msg.platform, msg.conversationId)
        if (!binding) return reply(NO_BINDING_HINT)
        const target = this.describeTarget(binding)
        const running = agentSessionManager.isRunning(binding.subchatId)
        const queued = agentSessionManager.queuedPrompts(binding.subchatId).length
        const { approvals, suspensions } = pendingFor(binding.subchatId)
        const lines = [
          `Bound to ${target}.`,
          running ? 'Agent is running.' : 'Agent is idle.',
          queued > 0 ? `${queued} prompt${queued === 1 ? '' : 's'} queued.` : '',
          approvals.length > 0
            ? `${approvals.length} pending approval${approvals.length === 1 ? '' : 's'} — reply "approve" or "deny [reason]".`
            : '',
          suspensions.length > 0 ? 'The agent asked a question — reply with your answer.' : ''
        ].filter(Boolean)
        await reply(lines.join('\n'))
        return
      }
      case 'unbind': {
        const removed = deleteBindingByConversation(msg.platform, msg.conversationId)
        this.rebuildSubscriptions()
        await reply(removed ? 'Binding removed.' : 'Nothing was bound here.')
        return
      }
      case 'approve':
      case 'deny': {
        const binding = getBinding(msg.platform, msg.conversationId)
        if (!binding) return reply(NO_BINDING_HINT)
        const { approvals } = pendingFor(binding.subchatId)
        const picked = pickPending(approvals, command.index)
        if ('error' in picked) {
          if (picked.error === 'none') return reply('No pending approvals.')
          const list = approvals
            .map(
              (a, i) =>
                `${i + 1}. \`${a.toolName}\` ${compactArgs(a.args).replace(/\s+/g, ' ').slice(0, 120)}`
            )
            .join('\n')
          return reply(
            (picked.error === 'ambiguous'
              ? 'Several approvals are pending — say which one:'
              : `There is no approval number ${command.index}. Pending:`) +
              `\n${list}\nReply "approve <n>" or "deny <n> [reason]".`
          )
        }
        const target = picked.ok
        // Never resolve a tool call this conversation was not shown: relay it
        // now and make the user answer again with the details in front of them.
        const relayed = this.relayedFor(binding.subchatId)
        if (!relayed.has(target.toolCallId)) {
          relayed.add(target.toolCallId)
          return reply(formatApprovalMessage(target.toolName, target.args))
        }
        try {
          this.resolvedRemotely.add(target.toolCallId)
          await agentSessionManager.approve(
            binding.subchatId,
            target.toolCallId,
            command.kind === 'approve' ? 'approve' : 'decline',
            command.kind === 'deny' ? command.reason : undefined
          )
          await reply(
            command.kind === 'approve'
              ? `Approved ${target.toolName}.`
              : `Declined ${target.toolName}.`
          )
        } catch {
          this.resolvedRemotely.delete(target.toolCallId)
          await reply('That approval was already handled.')
        }
        return
      }
      case 'prompt': {
        if (!command.text.trim()) return
        const binding = getBinding(msg.platform, msg.conversationId)
        if (!binding) return reply(NO_BINDING_HINT)

        // A pending ask_user question swallows plain text as its answer.
        // Pending tool approvals are only ever resolved by explicit
        // approve/deny — a queued follow-up must never approve a command.
        const { suspensions } = pendingFor(binding.subchatId)
        const question = suspensions.find((s) => s.toolName === 'ask_user')
        if (question) {
          this.resolvedRemotely.add(question.toolCallId)
          await agentSessionManager.respondSuspension(
            binding.subchatId,
            question.toolCallId,
            command.text,
            question.toolName
          )
          await reply('Answer sent.')
          return
        }

        const busy =
          agentSessionManager.isRunning(binding.subchatId) ||
          agentSessionManager.queuedPrompts(binding.subchatId).length > 0
        agentSessionManager.postMarker(
          binding.subchatId,
          `Remote prompt via ${PLATFORM_LABEL[msg.platform]} (${msg.userId})`
        )
        await agentSessionManager.sendOrQueue(binding.subchatId, command.text)
        this.ensureSubscribed(binding.subchatId)
        await reply(
          busy
            ? 'Queued (agent busy) — I\u2019ll reply here when the run finishes.'
            : 'On it — I\u2019ll reply here when the run finishes.'
        )
        return
      }
    }
  }

  private describeTarget(binding: BindingRow): string {
    const project = listProjects().find((p) => p.id === binding.projectId)
    const chat = listChats(binding.projectId).find((c) => c.id === binding.chatId)
    return `${project?.name ?? 'unknown project'} / ${chat?.name ?? 'unknown chat'}`
  }
}

// ---- Helpers -----------------------------------------------------------------

/** Pending approvals + suspensions for a subchat, oldest first. */
function pendingFor(subchatId: string): {
  approvals: PendingApproval[]
  suspensions: PendingSuspension[]
} {
  const approvals: PendingApproval[] = []
  const suspensions: PendingSuspension[] = []
  for (const ev of agentSessionManager.pendingApprovals(subchatId)) {
    if (ev.type === 'approval-request') approvals.push(ev.approval)
    else if (ev.type === 'suspension-request') suspensions.push(ev.suspension)
  }
  return { approvals, suspensions }
}
