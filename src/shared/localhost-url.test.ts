import { describe, expect, it } from 'vitest'
import { isLocalhostHttpUrl, normalizeLocalhostUrl } from './localhost-url'

describe('isLocalhostHttpUrl', () => {
  it('accepts loopback hosts with ports and paths', () => {
    expect(isLocalhostHttpUrl('http://localhost:5173')).toBe(true)
    expect(isLocalhostHttpUrl('http://localhost:5173/app?tab=1#x')).toBe(true)
    expect(isLocalhostHttpUrl('http://127.0.0.1:3000/api')).toBe(true)
    expect(isLocalhostHttpUrl('http://0.0.0.0:8000')).toBe(true)
    expect(isLocalhostHttpUrl('http://[::1]:4200')).toBe(true)
    expect(isLocalhostHttpUrl('https://localhost')).toBe(true)
  })

  it('rejects non-loopback hosts and non-http schemes', () => {
    expect(isLocalhostHttpUrl('https://example.com')).toBe(false)
    expect(isLocalhostHttpUrl('http://localhost.evil.com')).toBe(false)
    expect(isLocalhostHttpUrl('http://127.0.0.1.evil.com')).toBe(false)
    expect(isLocalhostHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isLocalhostHttpUrl('ftp://localhost')).toBe(false)
    expect(isLocalhostHttpUrl('about:blank')).toBe(false)
    expect(isLocalhostHttpUrl('not a url')).toBe(false)
    expect(isLocalhostHttpUrl('')).toBe(false)
  })
})

describe('normalizeLocalhostUrl', () => {
  it('rewrites 0.0.0.0 to localhost, keeping port and path', () => {
    expect(normalizeLocalhostUrl('http://0.0.0.0:8000/docs')).toBe('http://localhost:8000/docs')
  })

  it('leaves other hosts and garbage untouched', () => {
    expect(normalizeLocalhostUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/')
    expect(normalizeLocalhostUrl('garbage')).toBe('garbage')
  })
})
