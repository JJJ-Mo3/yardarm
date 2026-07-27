/**
 * Pure mapping from LSP-protocol diagnostics (0-based positions, numeric
 * severity 1–4) to the plain 1-based LspDiagnosticInfo shape shared with the
 * renderer, which feeds Monaco markers and the IDE problems panel directly.
 */
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
