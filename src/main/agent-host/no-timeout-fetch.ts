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
 *
 * Request inputs are unpacked before dispatch: the SDK sometimes calls
 * fetch(new Request(...)) with Node's native Request, which fails the npm
 * undici package's brand check and gets stringified into `new URL()`
 * ("Failed to parse URL from [object Request]"). Headers and AbortSignal
 * cross realms fine, so forwarding url/method/headers/body/signal as plain
 * init fields restores correct behavior.
 */
import { Agent, fetch as undiciFetch } from 'undici'
import type { Dispatcher } from 'undici'

type UndiciFetchArgs = Parameters<typeof undiciFetch>

type RequestLike = {
  url: string
  method: string
  headers: Headers
  signal: AbortSignal
  arrayBuffer(): Promise<ArrayBuffer>
}

const isRequestLike = (input: unknown): input is RequestLike =>
  typeof input === 'object' &&
  input !== null &&
  !(input instanceof URL) &&
  typeof (input as RequestLike).url === 'string' &&
  typeof (input as RequestLike).method === 'string'

export function buildNoTimeoutFetch(
  dispatcher: Dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
): typeof globalThis.fetch {
  const patched = async (
    input: UndiciFetchArgs[0] | Request,
    init?: UndiciFetchArgs[1]
  ): Promise<Response> => {
    if (isRequestLike(input)) {
      const body =
        input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.arrayBuffer()
      return (await undiciFetch(input.url, {
        method: input.method,
        headers: input.headers as unknown as NonNullable<UndiciFetchArgs[1]>['headers'],
        body,
        signal: input.signal,
        ...init,
        dispatcher
      })) as unknown as Response
    }
    return (await undiciFetch(input, { ...init, dispatcher })) as unknown as Response
  }
  return patched as typeof globalThis.fetch
}

export function installNoTimeoutFetch(): void {
  globalThis.fetch = buildNoTimeoutFetch()
}
