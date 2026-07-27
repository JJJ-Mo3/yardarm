/**
 * Share MCP OAuth sign-ins across worktrees. The mastracode SDK stores OAuth
 * tokens in <appData>/mastracode/mcp-oauth/<fingerprint>.json where the
 * fingerprint hashes the *projectDir* (git toplevel of the host cwd) along
 * with the server identity — so a chat running in a worktree gets different
 * fingerprints than the project root and never sees Connectors sign-ins.
 * This module reimplements the SDK's fingerprint exactly and copies the
 * newest token file onto missing/out-of-date sibling fingerprints.
 *
 * The fingerprint algorithm is SDK-internal and unversioned; the vitest
 * known-vector test is the tripwire when bumping the bundled runtime
 * (@mastra/code-sdk dist/mcp/manager.js getOAuthStoragePath).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { readMcpJson, type McpServerConfig } from './mcp-json'

const execFileP = promisify(execFile)

const DEFAULT_OAUTH_REDIRECT_URL = 'http://127.0.0.1:1458/oauth/callback'

interface OAuthConfigLike {
  callbackPort?: number
  redirectUrl?: string
  clientId?: string
  scopes?: string[]
}

/** FNV-1a 64-bit hex fingerprint — must match the SDK's getStorageKeyFingerprint. */
export function storageKeyFingerprint(value: string): string {
  let fingerprint = 0xcbf29ce484222325n
  for (let i = 0; i < value.length; i += 1) {
    fingerprint ^= BigInt(value.charCodeAt(i))
    fingerprint = BigInt.asUintN(64, fingerprint * 0x100000001b3n)
  }
  return fingerprint.toString(16).padStart(16, '0')
}

function resolveRedirectUrl(oauth: OAuthConfigLike | undefined): string {
  if (oauth?.callbackPort !== undefined) return `http://localhost:${oauth.callbackPort}/callback`
  return oauth?.redirectUrl ?? DEFAULT_OAUTH_REDIRECT_URL
}

function oauthOf(cfg: McpServerConfig): OAuthConfigLike | undefined {
  const oauth = cfg.oauth
  return oauth && typeof oauth === 'object' ? (oauth as OAuthConfigLike) : undefined
}

/**
 * The exact JSON key the SDK fingerprints. Key order and the
 * omit-when-undefined behavior of clientId both matter.
 */
export function oauthStorageKey(projectDir: string, name: string, cfg: McpServerConfig): string {
  const oauth = oauthOf(cfg)
  return JSON.stringify({
    projectDir,
    name,
    url: cfg.url,
    redirectUrl: resolveRedirectUrl(oauth),
    clientId: oauth?.clientId,
    scopes: oauth?.scopes ?? []
  })
}

/** Server identity independent of projectDir — tokens only mirror within a group. */
function serverIdentity(name: string, cfg: McpServerConfig): string {
  const oauth = oauthOf(cfg)
  return JSON.stringify({
    name,
    url: cfg.url,
    redirectUrl: resolveRedirectUrl(oauth),
    clientId: oauth?.clientId,
    scopes: oauth?.scopes ?? []
  })
}

/** Mirrors the SDK's getAppDataDir (utils/project.js) + the mcp-oauth subdir. */
export function oauthTokenDir(): string {
  if (process.env.MASTRA_APP_DATA_DIR) {
    return path.join(process.env.MASTRA_APP_DATA_DIR, 'mcp-oauth')
  }
  const platform = os.platform()
  let baseDir: string
  if (platform === 'darwin') {
    baseDir = path.join(os.homedir(), 'Library', 'Application Support')
  } else if (platform === 'win32') {
    baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  } else {
    baseDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  }
  return path.join(baseDir, 'mastracode', 'mcp-oauth')
}

/** git toplevel of a cwd (worktrees resolve to the worktree path), else the cwd itself. */
async function gitToplevel(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', '--show-toplevel'], { cwd })
    return stdout.trim() || cwd
  } catch {
    return cwd
  }
}

/** Root .mcp.json in a project dir (also merged by the SDK's loadMcpConfig). */
async function readRootMcpServers(dir: string): Promise<Record<string, McpServerConfig>> {
  try {
    const raw = await fs.readFile(path.join(dir, '.mcp.json'), 'utf8')
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> }
    return parsed.mcpServers ?? {}
  } catch {
    return {}
  }
}

/** Merged remote (url-based) servers a host booted in this toplevel would see. */
async function serversForToplevel(
  toplevel: string,
  globalServers: Record<string, McpServerConfig>
): Promise<Record<string, McpServerConfig>> {
  const root = await readRootMcpServers(toplevel)
  const project = (await readMcpJson(toplevel)).mcpServers ?? {}
  const merged = { ...globalServers, ...root, ...project }
  const remote: Record<string, McpServerConfig> = {}
  for (const [name, cfg] of Object.entries(merged)) {
    if (cfg && typeof cfg.url === 'string') remote[name] = cfg
  }
  return remote
}

/**
 * Copy the newest MCP OAuth token file onto missing/differing sibling
 * fingerprints across the given cwds. Copies (never links) because the SDK
 * persists via tmp+rename, which would break links. Best-effort: never throws.
 * Returns the number of token files written.
 */
export async function mirrorMcpOAuthTokens(cwds: string[]): Promise<number> {
  try {
    const toplevels = [...new Set(await Promise.all([...new Set(cwds)].map(gitToplevel)))]
    if (toplevels.length < 2) return 0
    const tokenDir = oauthTokenDir()
    const globalServers = (await readMcpJson()).mcpServers ?? {}

    // identity → distinct token paths across toplevels
    const groups = new Map<string, Set<string>>()
    for (const toplevel of toplevels) {
      const servers = await serversForToplevel(toplevel, globalServers)
      for (const [name, cfg] of Object.entries(servers)) {
        const id = serverIdentity(name, cfg)
        const file = path.join(
          tokenDir,
          `${storageKeyFingerprint(oauthStorageKey(toplevel, name, cfg))}.json`
        )
        const set = groups.get(id) ?? new Set()
        set.add(file)
        groups.set(id, set)
      }
    }

    let copies = 0
    for (const files of groups.values()) {
      if (files.size < 2) continue
      // Find the newest existing token file in the group.
      let newest: { file: string; mtimeMs: number } | null = null
      for (const file of files) {
        const stat = await fs.stat(file).catch(() => null)
        if (stat && (!newest || stat.mtimeMs > newest.mtimeMs)) {
          newest = { file, mtimeMs: stat.mtimeMs }
        }
      }
      if (!newest) continue
      const content = await fs.readFile(newest.file, 'utf8').catch(() => null)
      if (content == null) continue
      for (const file of files) {
        if (file === newest.file) continue
        const existing = await fs.readFile(file, 'utf8').catch(() => null)
        if (existing === content) continue
        try {
          await fs.mkdir(tokenDir, { recursive: true, mode: 0o700 })
          const tmp = `${file}.tmp-${process.pid}`
          await fs.writeFile(tmp, content, { mode: 0o600 })
          await fs.rename(tmp, file)
          copies += 1
        } catch {}
      }
    }
    return copies
  } catch {
    return 0
  }
}
