/**
 * Small testable helpers behind the agent host's LSP diagnostics collector:
 * mapping LSP-protocol diagnostics (0-based positions, numeric severity 1–4)
 * to the plain 1-based LspDiagnosticInfo shape shared with the renderer,
 * language-id fallbacks for extensions the SDK's map lacks (Ruby/ERB), and
 * executable resolution for external PATH-based language servers.
 */
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import path from 'node:path'
import type { LspDiagnosticInfo } from '../../shared/ipc-types'

const SEVERITIES: Record<number, LspDiagnosticInfo['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint'
}

interface LspPosition {
  line?: number
  character?: number
}

/** Loose view of a vscode-languageserver-protocol Diagnostic. */
export interface LspRawDiagnostic {
  range?: { start?: LspPosition; end?: LspPosition }
  severity?: number
  message?: unknown
  source?: unknown
  [key: string]: unknown
}

/**
 * URI keys a language server may publish diagnostics under for one path. The
 * SDK's LSPClient keys its map by the raw `file://${path}` it sent in didOpen,
 * but servers (tsls at least) normalize to a percent-encoded URI — for paths
 * with spaces (every Yardarm worktree lives under "Application Support") the
 * publish lands under the encoded key and the SDK's own lookups miss it.
 */
export function lspUriCandidates(filePath: string): string[] {
  const raw = `file://${filePath}`
  const encoded = `file://${encodeURI(filePath)}`
  return raw === encoded ? [raw] : [raw, encoded]
}

/** Extensions the SDK's language map lacks; consulted after getLanguageId. */
const FALLBACK_EXTENSION_IDS: Record<string, string> = {
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.gemspec': 'ruby',
  '.erb': 'erb'
}

/** Extensionless well-known filenames (Ruby build/dependency files). */
const FALLBACK_BASENAME_IDS: Record<string, string> = {
  Gemfile: 'ruby',
  Rakefile: 'ruby'
}

/**
 * Language id for files the SDK's getLanguageId doesn't know (it has no
 * Ruby/ERB entries at all). `.html.erb` resolves via its final `.erb` suffix.
 */
export function fallbackLanguageId(filePath: string): string | undefined {
  const base = path.basename(filePath)
  return FALLBACK_BASENAME_IDS[base] ?? FALLBACK_EXTENSION_IDS[path.extname(base).toLowerCase()]
}

/**
 * Resolve an executable by name against a PATH-style env value plus extra
 * well-known install dirs (GUI/login PATHs regularly miss ~/go/bin and
 * friends). Returns the first hit that is an executable regular file.
 */
export function findExecutable(
  name: string,
  pathEnv: string | undefined,
  extraDirs: string[]
): string | null {
  const dirs = [...(pathEnv ? pathEnv.split(path.delimiter) : []), ...extraDirs]
  for (const dir of dirs) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      accessSync(candidate, fsConstants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // not there / not executable — keep looking
    }
  }
  return null
}

export function mapLspDiagnostics(raw: unknown): LspDiagnosticInfo[] {
  if (!Array.isArray(raw)) return []
  const out: LspDiagnosticInfo[] = []
  for (const entry of raw as LspRawDiagnostic[]) {
    if (!entry || typeof entry !== 'object') continue
    const message = typeof entry.message === 'string' ? entry.message : ''
    if (!message) continue
    const start = entry.range?.start
    const end = entry.range?.end
    const line = (start?.line ?? 0) + 1
    const col = (start?.character ?? 0) + 1
    out.push({
      line,
      col,
      endLine: (end?.line ?? start?.line ?? 0) + 1,
      endCol: end?.character !== undefined ? end.character + 1 : col,
      severity: SEVERITIES[entry.severity ?? 0] ?? 'info',
      message,
      ...(typeof entry.source === 'string' ? { source: entry.source } : {})
    })
  }
  out.sort((a, b) => a.line - b.line || a.col - b.col)
  return out
}
