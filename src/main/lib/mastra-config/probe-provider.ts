/**
 * Probe an OpenAI-compatible server's GET /models endpoint from the main
 * process (the renderer would hit CORS). Used by the local-model wizard to
 * test connections and list installed models.
 */
import type { ProbeResult } from '../../../shared/mastra-settings'

export function normalizeFetchError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string } }).cause
    if (cause?.code === 'ECONNREFUSED') return 'Connection refused — is the server running?'
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Timed out after 3s'
    if (err instanceof SyntaxError) return 'Server responded but not with OpenAI-compatible JSON'
    if (cause?.code) return `${cause.code}: ${err.message}`
    return err.message
  }
  return String(err)
}

export async function probeOpenAiCompatible(opts: {
  url: string
  apiKey?: string
}): Promise<ProbeResult> {
  const base = opts.url.trim().replace(/\/+$/, '')
  const candidates = [base]
  // Tolerate a base URL without the version segment (e.g. http://localhost:11434).
  if (!/\/v\d+$/.test(base)) candidates.push(`${base}/v1`)

  let lastError = ''
  for (const candidate of candidates) {
    try {
      const res = await fetch(`${candidate}/models`, {
        headers: opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : undefined,
        signal: AbortSignal.timeout(3000)
      })
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${candidate}/models`
        continue
      }
      const body = (await res.json()) as { data?: Array<{ id?: unknown }> }
      const models = (Array.isArray(body?.data) ? body.data : [])
        .map((m) => (typeof m?.id === 'string' ? m.id : null))
        .filter((id): id is string => !!id)
      return { ok: true, url: candidate, models }
    } catch (err) {
      lastError = normalizeFetchError(err)
    }
  }
  return { ok: false, url: base, models: [], error: lastError || 'Could not reach server' }
}
