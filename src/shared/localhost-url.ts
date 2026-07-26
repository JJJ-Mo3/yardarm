/**
 * Localhost-only URL helpers shared by the Preview tab (renderer) and the
 * main-process webview hardening: the in-app preview may only ever load
 * http(s) URLs whose host is a loopback address.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

export function isLocalhostHttpUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return LOCAL_HOSTS.has(url.hostname)
}

/** Rewrites the bind-address form (0.0.0.0) to a browsable localhost URL. */
export function normalizeLocalhostUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.hostname === '0.0.0.0') url.hostname = 'localhost'
    return url.toString()
  } catch {
    return raw
  }
}
