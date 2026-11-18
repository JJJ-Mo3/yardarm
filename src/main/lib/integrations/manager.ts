/**
 * Integrations manager: owns the per-platform adapters (Slack Socket Mode,
 * Discord Gateway), their connect lifecycle with capped jittered backoff, the
 * non-secret config blob in app_settings, and the shared IntegrationsCore.
 * Started fire-and-forget from src/main/index.ts — connect failures surface
 * as status, never into app startup.
 */
import { EventEmitter } from 'node:events'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import {
  DEFAULT_INTEGRATIONS_CONFIG,
  INTEGRATION_PLATFORMS,
  type ConnectionStatus,
  type IntegrationPlatform,
  type IntegrationStatusMap,
  type IntegrationsConfig
} from '../../../shared/integrations'
import type { IntegrationAdapter } from './types'
import { IntegrationsCore } from './core'
import { getSecret } from './secrets'
import { SlackAdapter } from './adapters/slack'
import { DiscordAdapter } from './adapters/discord'

const CONFIG_KEY = 'integrations.config'
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 60_000
const FALLBACK_MAX_LEN: Record<IntegrationPlatform, number> = { slack: 3900, discord: 1900 }

export function readIntegrationsConfig(): IntegrationsConfig {
  try {
    const row = getDb()
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, CONFIG_KEY))
      .get()
    if (row) {
      const parsed = JSON.parse(row.value) as Partial<IntegrationsConfig>
      return {
        slack: { ...DEFAULT_INTEGRATIONS_CONFIG.slack, ...parsed.slack },
        discord: { ...DEFAULT_INTEGRATIONS_CONFIG.discord, ...parsed.discord }
      }
    }
  } catch {}
  return structuredClone(DEFAULT_INTEGRATIONS_CONFIG)
}

export function writeIntegrationsConfig(config: IntegrationsConfig): void {
  const value = JSON.stringify(config)
  getDb()
    .insert(schema.appSettings)
    .values({ key: CONFIG_KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
    .run()
}

class IntegrationsManager {
  private core = new IntegrationsCore({
    isAllowed: (platform, userId) => this.isAllowed(platform, userId),
    send: (platform, conversationId, text) => this.send(platform, conversationId, text),
    maxMessageLength: (platform) =>
      this.adapters.get(platform)?.maxMessageLength ?? FALLBACK_MAX_LEN[platform]
  })

  private adapters = new Map<IntegrationPlatform, IntegrationAdapter>()
  private statusMap: IntegrationStatusMap = {
    slack: { state: 'disconnected' },
    discord: { state: 'disconnected' }
  }
  private emitter = new EventEmitter()
  private retryTimers = new Map<IntegrationPlatform, NodeJS.Timeout>()
  private retryDelays = new Map<IntegrationPlatform, number>()
  private stopped = false

  // ---- Status ---------------------------------------------------------------

  status(): IntegrationStatusMap {
    return { ...this.statusMap }
  }

  onStatus(listener: (status: IntegrationStatusMap) => void): () => void {
    this.emitter.on('status', listener)
    return () => this.emitter.off('status', listener)
  }

  private setStatus(platform: IntegrationPlatform, status: ConnectionStatus): void {
    this.statusMap = { ...this.statusMap, [platform]: status }
    this.emitter.emit('status', this.status())
  }

  // ---- Core plumbing ---------------------------------------------------------

  private isAllowed(platform: IntegrationPlatform, userId: string): boolean {
    const cfg = readIntegrationsConfig()[platform]
    return cfg.enabled && (cfg.allowAllUsers || cfg.allowedUserIds.includes(userId))
  }

  private async send(
    platform: IntegrationPlatform,
    conversationId: string,
    text: string
  ): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) throw new Error(`${platform} is not connected`)
    await adapter.send(conversationId, text)
  }

  /** Called whenever bindings change (bot commands or the settings UI). */
  notifyBindingsChanged(): void {
    this.core.rebuildSubscriptions()
  }

  // ---- Adapter lifecycle -----------------------------------------------------

  private missingSecrets(platform: IntegrationPlatform): string | null {
    if (platform === 'slack') {
      if (!getSecret('slackAppToken') || !getSecret('slackBotToken'))
        return 'Set both the app token (xapp-…) and bot token (xoxb-…) first.'
    } else if (!getSecret('discordBotToken')) {
      return 'Set the bot token first.'
    }
    return null
  }

  private buildAdapter(platform: IntegrationPlatform): IntegrationAdapter {
    if (platform === 'slack') {
      return new SlackAdapter(getSecret('slackAppToken')!, getSecret('slackBotToken')!)
    }
    return new DiscordAdapter(getSecret('discordBotToken')!)
  }

  private clearRetry(platform: IntegrationPlatform): void {
    const timer = this.retryTimers.get(platform)
    if (timer) clearTimeout(timer)
    this.retryTimers.delete(platform)
  }

  private scheduleRetry(platform: IntegrationPlatform): void {
    if (this.stopped || this.retryTimers.has(platform)) return
    const base = this.retryDelays.get(platform) ?? BACKOFF_MIN_MS
    this.retryDelays.set(platform, Math.min(base * 2, BACKOFF_MAX_MS))
    const delay = base + Math.random() * base * 0.5
    const timer = setTimeout(() => {
      this.retryTimers.delete(platform)
      void this.startPlatform(platform)
    }, delay)
    timer.unref()
    this.retryTimers.set(platform, timer)
  }

  private async stopPlatform(platform: IntegrationPlatform): Promise<void> {
    this.clearRetry(platform)
    const adapter = this.adapters.get(platform)
    this.adapters.delete(platform)
    if (adapter) {
      try {
        await adapter.disconnect()
      } catch {}
    }
    this.setStatus(platform, { state: 'disconnected' })
  }

  /** (Re)start one platform from current config + secrets. */
  async startPlatform(platform: IntegrationPlatform): Promise<void> {
    await this.stopPlatform(platform)
    if (this.stopped) return
    if (!readIntegrationsConfig()[platform].enabled) return
    const missing = this.missingSecrets(platform)
    if (missing) {
      this.setStatus(platform, { state: 'error', detail: missing })
      return
    }

    const adapter = this.buildAdapter(platform)
    this.adapters.set(platform, adapter)
    adapter.onMessage((msg) => {
      void this.core.handleInbound(msg).catch((err) => {
        console.error('[integrations] inbound failed', platform, err)
      })
    })
    adapter.onStatus((status) => {
      if (this.adapters.get(platform) !== adapter) return // superseded
      this.setStatus(platform, status)
      if (status.state === 'connected') {
        this.retryDelays.set(platform, BACKOFF_MIN_MS)
      } else if (status.state === 'error') {
        this.scheduleRetry(platform)
      }
    })

    this.setStatus(platform, { state: 'connecting' })
    try {
      await adapter.connect()
    } catch (err) {
      if (this.adapters.get(platform) !== adapter) return
      this.setStatus(platform, {
        state: 'error',
        detail: err instanceof Error ? err.message : String(err)
      })
      this.scheduleRetry(platform)
    }
  }

  /** Restart the given platforms (config/secret mutations). */
  async applyConfig(platforms: IntegrationPlatform[] = [...INTEGRATION_PLATFORMS]): Promise<void> {
    this.stopped = false
    for (const platform of platforms) await this.startPlatform(platform)
    this.core.rebuildSubscriptions()
  }

  start(): void {
    this.stopped = false
    this.core.rebuildSubscriptions()
    for (const platform of INTEGRATION_PLATFORMS) {
      void this.startPlatform(platform).catch((err) =>
        console.error('[integrations] start failed', platform, err)
      )
    }
  }

  stopAll(): void {
    this.stopped = true
    for (const platform of INTEGRATION_PLATFORMS) {
      void this.stopPlatform(platform)
    }
    this.core.dispose()
  }
}

export const integrationsManager = new IntegrationsManager()

/** Fire-and-forget start; returns the stopper for before-quit. */
export function startIntegrations(): () => void {
  integrationsManager.start()
  return () => integrationsManager.stopAll()
}
