/**
 * Discord adapter: discord.js Gateway client. Requires the privileged
 * Message Content intent — when it isn't granted in the developer portal the
 * gateway rejects the identify and connect() fails with a clear hint. Other
 * bots' messages are ignored; empty-content messages (attachment-only posts)
 * are skipped. In-session reconnects are handled by discord.js; terminal
 * drops surface as an error status so the manager rebuilds with backoff.
 */
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js'
import type { ConnectionStatus, IntegrationPlatform } from '../../../../shared/integrations'
import type { InboundMessage, IntegrationAdapter } from '../types'

export class DiscordAdapter implements IntegrationAdapter {
  readonly platform: IntegrationPlatform = 'discord'
  readonly maxMessageLength = 1900

  private client: Client
  private token: string
  private closing = false
  private messageListeners: Array<(msg: InboundMessage) => void> = []
  private statusListeners: Array<(status: ConnectionStatus) => void> = []

  constructor(botToken: string) {
    this.token = botToken
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
      ],
      partials: [Partials.Channel] // DMs arrive on partial channels
    })

    this.client.on(Events.ClientReady, () => this.emitStatus({ state: 'connected' }))
    this.client.on(Events.ShardReconnecting, () =>
      this.emitStatus({ state: 'connecting', detail: 'Reconnecting…' })
    )
    this.client.on(Events.ShardResume, () => this.emitStatus({ state: 'connected' }))
    this.client.on(Events.ShardDisconnect, () => {
      if (!this.closing) this.emitStatus({ state: 'error', detail: 'Gateway disconnected' })
    })
    this.client.on(Events.Invalidated, () => {
      if (!this.closing)
        this.emitStatus({ state: 'error', detail: 'Session invalidated — check the bot token' })
    })
    this.client.on(Events.Error, (err) => {
      if (!this.closing) this.emitStatus({ state: 'error', detail: err.message })
    })

    this.client.on(Events.MessageCreate, (message) => {
      if (message.author.bot) return
      const text = message.content.trim()
      if (!text) return // attachment/embed-only posts, or no content access
      const msg: InboundMessage = {
        platform: 'discord',
        conversationId: message.channelId,
        userId: message.author.id,
        text,
        messageId: message.id
      }
      for (const listener of this.messageListeners) listener(msg)
    })
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status)
  }

  async connect(): Promise<void> {
    try {
      await this.client.login(this.token)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/disallowed intents/i.test(message)) {
        throw new Error(
          'Discord rejected the connection: enable the "Message Content Intent" for this bot ' +
            'under Bot → Privileged Gateway Intents in the Discord developer portal.'
        )
      }
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.closing = true
    try {
      await this.client.destroy()
    } catch {}
  }

  async send(conversationId: string, text: string): Promise<void> {
    const channel = await this.client.channels.fetch(conversationId)
    if (!channel || !channel.isSendable()) {
      throw new Error(`Discord channel ${conversationId} is not sendable`)
    }
    await channel.send(text)
  }

  onMessage(listener: (msg: InboundMessage) => void): void {
    this.messageListeners.push(listener)
  }

  onStatus(listener: (status: ConnectionStatus) => void): void {
    this.statusListeners.push(listener)
  }
}
