/**
 * Shared types for remote messaging integrations (Slack / Discord). An
 * external conversation is bound to one project+chat via bot commands; the
 * main-process integrations manager relays prompts, final replies, tool
 * approvals and agent questions both ways. Platform is a plain string union
 * so future platforms (e.g. WhatsApp) only need a new adapter + config entry.
 */

export type IntegrationPlatform = 'slack' | 'discord'

export const INTEGRATION_PLATFORMS: IntegrationPlatform[] = ['slack', 'discord']

/** Non-secret per-platform settings, stored as one app_settings JSON blob. */
export interface PlatformConfig {
  enabled: boolean
  /** Platform user ids allowed to talk to the bot. Empty = deny everyone. */
  allowedUserIds: string[]
}

export interface IntegrationsConfig {
  slack: PlatformConfig
  discord: PlatformConfig
}

export const DEFAULT_INTEGRATIONS_CONFIG: IntegrationsConfig = {
  slack: { enabled: false, allowedUserIds: [] },
  discord: { enabled: false, allowedUserIds: [] }
}

/** Secret slots, stored write-only via safeStorage; renderer only sees booleans. */
export type IntegrationSecretKey = 'slackAppToken' | 'slackBotToken' | 'discordBotToken'

export interface IntegrationSecretsState {
  slackAppToken: boolean
  slackBotToken: boolean
  discordBotToken: boolean
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionStatus {
  state: ConnectionState
  /** Human-readable detail for error states (e.g. auth failure, missing intent). */
  detail?: string
}

export type IntegrationStatusMap = Record<IntegrationPlatform, ConnectionStatus>

/** A binding row joined with display names for the settings UI. */
export interface IntegrationBindingInfo {
  id: string
  platform: IntegrationPlatform
  conversationId: string
  projectId: string
  projectName: string
  chatId: string
  chatTitle: string
  subchatId: string
  createdAt: number
  updatedAt: number
}
