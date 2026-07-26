/**
 * Detects localhost dev-server URLs in terminal scrollback for the Preview
 * tab. Pure string processing over the pty rolling buffers: strip ANSI
 * (dev servers colorize their URLs), match loopback http(s) URLs, trim
 * trailing punctuation, and dedupe keeping the most recent occurrence first.
 */

// CSI sequences (colors, cursor moves) and OSC sequences (titles, hyperlinks).
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g

const URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s"'`<>()[\]]*)?/gi

export function extractLocalhostUrls(buffer: string): string[] {
  const text = buffer.replace(ANSI_RE, '')
  const lastIndex = new Map<string, number>()
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, '')
    lastIndex.set(url, m.index)
  }
  return [...lastIndex.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url)
}
