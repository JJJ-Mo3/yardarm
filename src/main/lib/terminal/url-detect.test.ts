import { describe, expect, it } from 'vitest'
import { extractLocalhostUrls } from './url-detect'

describe('extractLocalhostUrls', () => {
  it('finds vite-style output', () => {
    const buf = '  VITE v5.4.0  ready in 300 ms\n\n  ➜  Local:   http://localhost:5173/\n'
    expect(extractLocalhostUrls(buf)).toEqual(['http://localhost:5173/'])
  })

  it('finds next and http.server style output', () => {
    const buf =
      '- Local:        http://localhost:3000\n' +
      'Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...\n'
    expect(extractLocalhostUrls(buf)).toEqual(['http://0.0.0.0:8000/', 'http://localhost:3000'])
  })

  it('strips ANSI color codes wrapping the URL', () => {
    const buf = '\u001b[32m➜\u001b[39m  Local: \u001b[36mhttp://localhost:5173/\u001b[39m\n'
    expect(extractLocalhostUrls(buf)).toEqual(['http://localhost:5173/'])
  })

  it('dedupes keeping the most recent occurrence first', () => {
    const buf =
      'http://localhost:3000\nhttp://127.0.0.1:9229\nrestarted...\nhttp://localhost:3000\n'
    expect(extractLocalhostUrls(buf)).toEqual(['http://localhost:3000', 'http://127.0.0.1:9229'])
  })

  it('trims trailing punctuation and ignores non-localhost URLs', () => {
    const buf = 'Open http://localhost:8080/docs. See https://example.com/help for more.\n'
    expect(extractLocalhostUrls(buf)).toEqual(['http://localhost:8080/docs'])
  })

  it('handles IPv6 loopback and empty buffers', () => {
    expect(extractLocalhostUrls('listening on http://[::1]:4200')).toEqual(['http://[::1]:4200'])
    expect(extractLocalhostUrls('')).toEqual([])
  })
})
