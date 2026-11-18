/**
 * Main-process types for remote messaging integrations. An adapter wraps one
 * platform's realtime connection (Slack Socket Mode, Discord Gateway) behind
 * a tiny interface so the core routing/relay logic is platform-agnostic —
 * adding a platform (e.g. WhatsApp) means a new adapter + config entry only.
 */
import type { ConnectionStatus, IntegrationPlatform } from '../../../shared/integrations'

/** A user message received from an external conversation. */
export interface InboundMessage {
  platform: IntegrationPlatform
  /** Slack channel/DM id or Discord channel id. */
  conversationId: string
  /** Platform user id of the sender (allowlist subject). */
  userId: string
  text: string
  /** Platform message id, used for duplicate-delivery suppression. */
  messageId?: string
}

export interface IntegrationAdapter {
  readonly platform: IntegrationPlatform
  /** Safe outbound chunk size (under the platform's hard message limit). */
  readonly maxMessageLength: number
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(conversationId: string, text: string): Promise<void>
  onMessage(listener: (msg: InboundMessage) => void): void
  onStatus(listener: (status: ConnectionStatus) => void): void
}
