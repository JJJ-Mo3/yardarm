/**
 * Global-fetch patch for the agent host: disables undici's idle timeouts.
 *
 * Node's built-in fetch aborts a request when the server sends no bytes for
 * ~300s (undici headersTimeout/bodyTimeout). Slow local models (Ollama etc.)
 * can sit silent longer than that while prefilling a long context, so runs
 * die mid-task with "TypeError: terminated". The mastracode SDK resolves
 * globalThis.fetch lazily per request and exposes no timeout configuration,
 * so the host swaps in an undici fetch dispatched through an Agent with both
 * idle timeouts disabled. Connect timeouts keep undici defaults (dead servers
 * still fail fast) and AbortSignal cancellation is unaffected.
 */
import { Agent, fetch as undiciFetch } from 'undici'
import type { Dispatcher } from 'undici'

type UndiciFetchArgs = Parameters<typeof undiciFetch>

export function buildNoTimeoutFetch(
  dispatcher: Dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
): typeof globalThis.fetch {
  const patched = (input: UndiciFetchArgs[0], init?: UndiciFetchArgs[1]): Promise<Response> =>
    undiciFetch(input, { ...init, dispatcher }) as unknown as Promise<Response>
  return patched as typeof globalThis.fetch
}

export function installNoTimeoutFetch(): void {
  globalThis.fetch = buildNoTimeoutFetch()
}
