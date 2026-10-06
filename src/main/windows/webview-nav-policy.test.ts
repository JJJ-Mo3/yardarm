/**
 * Tests for the webview navigation policy: Preview guests must stay on
 * localhost, the Factory guest may follow its https sign-in redirect chain
 * in-place, and everything else either goes to the system browser (http/s)
 * or is dropped (custom schemes).
 */
import { describe, expect, it } from 'vitest'
import { webviewNavAction } from './webview-nav-policy'

describe('webviewNavAction', () => {
  it('allows localhost http(s) for both kinds', () => {
    for (const kind of ['preview', 'factory'] as const) {
      expect(webviewNavAction('http://localhost:4111/signin', kind)).toBe('allow')
      expect(webviewNavAction('https://localhost:4111/', kind)).toBe('allow')
      expect(webviewNavAction('http://127.0.0.1:3000/app', kind)).toBe('allow')
      expect(webviewNavAction('http://0.0.0.0:4111/', kind)).toBe('allow')
      expect(webviewNavAction('http://[::1]:4111/', kind)).toBe('allow')
    }
  })

  it('keeps external https in-webview only for the factory guest', () => {
    const url = 'https://platform.mastra.ai/v1/auth/login?product=deploy'
    expect(webviewNavAction(url, 'factory')).toBe('allow')
    expect(webviewNavAction(url, 'preview')).toBe('external')
  })

  it('sends non-localhost plain http to the system browser for both kinds', () => {
    for (const kind of ['preview', 'factory'] as const) {
      expect(webviewNavAction('http://example.com/', kind)).toBe('external')
    }
  })

  it('denies non-http schemes and garbage for both kinds', () => {
    for (const kind of ['preview', 'factory'] as const) {
      expect(webviewNavAction('file:///etc/passwd', kind)).toBe('deny')
      expect(webviewNavAction('mailto:someone@example.com', kind)).toBe('deny')
      expect(webviewNavAction('javascript:alert(1)', kind)).toBe('deny')
      expect(webviewNavAction('not a url', kind)).toBe('deny')
      expect(webviewNavAction('', kind)).toBe('deny')
    }
  })
})
