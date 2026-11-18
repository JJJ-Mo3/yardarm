/**
 * Bot token storage for remote messaging integrations. Tokens are encrypted
 * with Electron safeStorage (Keychain-backed on macOS) and stored base64 in
 * app_settings; when OS encryption is unavailable they fall back to a
 * 'plain:'-prefixed value. Raw tokens are write-only over IPC — the renderer
 * only ever sees "is set" booleans.
 */
import { safeStorage } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { IntegrationSecretKey, IntegrationSecretsState } from '../../../shared/integrations'

const SECRET_KEYS: Record<IntegrationSecretKey, string> = {
  slackAppToken: 'integrations.secret.slack.appToken',
  slackBotToken: 'integrations.secret.slack.botToken',
  discordBotToken: 'integrations.secret.discord.botToken'
}

const ENC_PREFIX = 'enc:'
const PLAIN_PREFIX = 'plain:'

function readRow(key: string): string | null {
  const row = getDb().select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get()
  return row?.value ?? null
}

function writeRow(key: string, value: string): void {
  getDb()
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
    .run()
}

export function setSecret(name: IntegrationSecretKey, token: string): void {
  const trimmed = token.trim()
  if (!trimmed) {
    clearSecret(name)
    return
  }
  let stored: string
  try {
    if (safeStorage.isEncryptionAvailable()) {
      stored = ENC_PREFIX + safeStorage.encryptString(trimmed).toString('base64')
    } else {
      stored = PLAIN_PREFIX + trimmed
    }
  } catch {
    stored = PLAIN_PREFIX + trimmed
  }
  writeRow(SECRET_KEYS[name], stored)
}

export function clearSecret(name: IntegrationSecretKey): void {
  getDb().delete(schema.appSettings).where(eq(schema.appSettings.key, SECRET_KEYS[name])).run()
}

/** Decrypt a stored token for main-process use (adapter connects). */
export function getSecret(name: IntegrationSecretKey): string | null {
  const stored = readRow(SECRET_KEYS[name])
  if (!stored) return null
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length)
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    } catch {
      return null // encrypted on another machine/keychain — treat as unset
    }
  }
  return null
}

/** Renderer-safe view: which secrets are set, never their values. */
export function secretsState(): IntegrationSecretsState {
  return {
    slackAppToken: readRow(SECRET_KEYS.slackAppToken) != null,
    slackBotToken: readRow(SECRET_KEYS.slackBotToken) != null,
    discordBotToken: readRow(SECRET_KEYS.discordBotToken) != null
  }
}
