/**
 * Slack adapter: Socket Mode (xapp- app token) for inbound events plus a Web
 * API client (xoxb- bot token) for outbound messages. Envelopes are acked
 * immediately on receipt (Slack redelivers otherwise); the bot's own messages
 * and other bot messages are ignored. Reconnection within a live session is
 * handled by the Socket Mode client itself; fatal drops surface as an error
 * status so the manager rebuilds the adapter with backoff.
 */
import { SocketModeClient, LogLevel } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'
import type { ConnectionStatus, IntegrationPlatform } from '../../../../shared/integrations'
import type { InboundMessage, IntegrationAdapter } from '../types'

interface SlackMessageEvent {
  type: string
  subtype?: string
  channel?: string
  user?: string
  text?: string
  ts?: string
  client_msg_id?: string
  bot_id?: string
}

export class SlackAdapter implements IntegrationAdapter {
  readonly platform: IntegrationPlatform = 'slack'
  readonly maxMessageLength = 3900

  private socket: SocketModeClient
  private web: WebClient
  private botUserId: string | null = null
  private closing = false
  private messageListeners: Array<(msg: InboundMessage) => void> = []
  private statusListeners: Array<(status: ConnectionStatus) => void> = []

  constructor(appToken: string, botToken: string) {
    this.socket = new SocketModeClient({ appToken, logLevel: LogLevel.ERROR })
    this.web = new WebClient(botToken, { logLevel: LogLevel.ERROR })

    this.socket.on('message', async ({ ack, event }) => {
      try {
        await ack()
      } catch {}
      this.handleEvent(event as SlackMessageEvent)
    })
    this.socket.on('connected', () => this.emitStatus({ state: 'connected' }))
    this.socket.on('reconnecting', () =>
      this.emitStatus({ state: 'connecting', detail: 'Reconnecting…' })
    )
    this.socket.on('disconnected', () => {
      if (!this.closing) this.emitStatus({ state: 'error', detail: 'Socket Mode disconnected' })
    })
    this.socket.on('error', (err: unknown) => {
      if (!this.closing)
        this.emitStatus({
          state: 'error',
          detail: err instanceof Error ? err.message : String(err)
        })
    })
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status)
  }

  private handleEvent(event: SlackMessageEvent): void {
    if (event.type !== 'message') return
    if (event.subtype || event.bot_id) return // edits, joins, bot posts
    if (!event.channel || !event.user || !event.text) return
    if (this.botUserId && event.user === this.botUserId) return
    const msg: InboundMessage = {
      platform: 'slack',
      conversationId: event.channel,
      userId: event.user,
      text: event.text,
      messageId: event.client_msg_id ?? `${event.channel}:${event.ts ?? ''}`
    }
    for (const listener of this.messageListeners) listener(msg)
  }

  async connect(): Promise<void> {
    // Validate the bot token first so a bad xoxb fails loudly instead of
    // silently breaking outbound sends later; also learn our own user id.
    const auth = await this.web.auth.test()
    this.botUserId = (auth.user_id as string | undefined) ?? null
    await this.socket.start()
  }

  async disconnect(): Promise<void> {
    this.closing = true
    try {
      await this.socket.disconnect()
    } catch {}
  }

  async send(conversationId: string, text: string): Promise<void> {
    await this.web.chat.postMessage({ channel: conversationId, text })
  }

  onMessage(listener: (msg: InboundMessage) => void): void {
    this.messageListeners.push(listener)
  }

  onStatus(listener: (status: ConnectionStatus) => void): void {
    this.statusListeners.push(listener)
  }
}
