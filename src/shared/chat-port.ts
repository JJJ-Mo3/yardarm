/**
 * A stable port per chat, so dev servers in different chats don't fight over
 * one port. The port is a pure function of the chat id (no storage): the id
 * is hashed into a block of 10 consecutive ports in 4100–4999, and the chat's
 * terminals and agent host see the first one as YARDARM_PORT and the last as
 * YARDARM_PORT_RANGE_END. Variables the user set in Project Settings →
 * Environment always win. Two chats can hash to the same block (90 blocks),
 * so callers that care compare the ports instead of assuming they differ.
 */

export const CHAT_PORT_MIN = 4100
export const CHAT_PORT_MAX = 4990
export const CHAT_PORT_BLOCK = 10

export const CHAT_PORT_ENV = 'YARDARM_PORT'
export const CHAT_PORT_RANGE_END_ENV = 'YARDARM_PORT_RANGE_END'

/** FNV-1a (32-bit) — tiny, stable across processes, no crypto dependency. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** First port of the chat's block: 4100, 4110, … 4990. */
export function chatPort(chatId: string): number {
  const blocks = (CHAT_PORT_MAX - CHAT_PORT_MIN) / CHAT_PORT_BLOCK + 1
  return CHAT_PORT_MIN + (fnv1a(chatId) % blocks) * CHAT_PORT_BLOCK
}

/**
 * The chat a terminal id belongs to, for the app's per-chat terminals
 * (`chat-<id>` shell, `cli-chat-<id>` CLI, `dev-chat-<id>` Preview dev
 * server); null for project-level and extra terminals.
 */
export function chatIdFromTerminalId(terminalId: string): string | null {
  for (const prefix of ['dev-chat-', 'cli-chat-', 'chat-']) {
    if (terminalId.startsWith(prefix) && terminalId.length > prefix.length) {
      return terminalId.slice(prefix.length)
    }
  }
  return null
}

/** Parse a TCP port out of an env value; null unless it is a plain integer 1–65535. */
export function parsePort(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,5}$/.test(value.trim())) return null
  const port = Number(value.trim())
  return port >= 1 && port <= 65535 ? port : null
}

/**
 * The user's per-project env plus the chat's port variables. User values win:
 * an explicit YARDARM_PORT is left alone (and no range end is invented for
 * it), and nothing else in `userEnv` is touched.
 */
export function withChatPortEnv(
  userEnv: Record<string, string>,
  chatId: string | null | undefined
): Record<string, string> {
  if (!chatId || CHAT_PORT_ENV in userEnv) return { ...userEnv }
  const port = chatPort(chatId)
  return {
    [CHAT_PORT_ENV]: String(port),
    [CHAT_PORT_RANGE_END_ENV]: String(port + CHAT_PORT_BLOCK - 1),
    ...userEnv
  }
}

/**
 * The port a Preview dev server for this chat is asked to use: a PORT or
 * YARDARM_PORT the user fixed in project env wins (then every chat shares
 * it), else the chat's own port; null for project-level servers with neither.
 */
export function devServerPort(
  chatId: string | null | undefined,
  userEnv: Record<string, string>
): number | null {
  const fixed = parsePort(userEnv.PORT) ?? parsePort(userEnv[CHAT_PORT_ENV])
  if (fixed !== null) return fixed
  return chatId ? chatPort(chatId) : null
}

/** Port of a localhost URL (scheme default when absent); null when unparsable. */
export function urlPort(url: string): number | null {
  try {
    const u = new URL(url.replace('[::1]', 'localhost'))
    if (u.port) return Number(u.port)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

/** Reorder detected URLs so those on `port` come first (order otherwise kept). */
export function preferPortUrls(urls: string[], port: number | null | undefined): string[] {
  if (!port) return urls
  const preferred = urls.filter((u) => urlPort(u) === port)
  if (preferred.length === 0) return urls
  return [...preferred, ...urls.filter((u) => urlPort(u) !== port)]
}

/**
 * Whether starting a dev server on `myPort` would clash with another running
 * one. They clash when neither has a known port (both fall back to the
 * project's default), when the ports are equal, or when the other server's
 * output shows it came up somewhere other than its assigned port — the
 * project hard-codes its port, so this one would land on the same port too.
 */
export function devServersClash(
  myPort: number | null,
  other: { port: number | null; seenPorts: number[] }
): boolean {
  if (myPort === null && other.port === null) return true
  if (myPort !== null && other.port !== null && myPort === other.port) return true
  if (other.port !== null && other.seenPorts.length > 0) {
    return !other.seenPorts.includes(other.port)
  }
  return false
}
