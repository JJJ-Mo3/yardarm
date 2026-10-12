/**
 * Tests for the agent host's no-idle-timeout fetch. A local HTTP server
 * stalls mid-body to prove (a) undici's bodyTimeout would kill the stream
 * (control agent with tiny timeouts), (b) the patched fetch survives the
 * stall, (c) AbortSignal cancellation still works, and (d) native Request
 * inputs are unpacked instead of being stringified into `new URL()`.
 */
import { createServer, type Server } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { Agent } from 'undici'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildNoTimeoutFetch } from './no-timeout-fetch'

let server: Server
let baseUrl: string
/** Per-request stall (ms) between the first body chunk and the rest. */
const STALL_MS = 300

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', baseUrl)
    if (url.pathname === '/echo') {
      // Echo method, a marker header, and the body for the Request-input tests.
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(`${req.method}|${req.headers['x-test'] ?? ''}|${Buffer.concat(chunks).toString()}`)
      })
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('hello ')
    const stall = Number(url.searchParams.get('stall') ?? STALL_MS)
    setTimeout(() => res.end('world'), stall)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no server address')
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('buildNoTimeoutFetch', () => {
  it('control: a short bodyTimeout kills the stalled stream (dispatcher is applied)', async () => {
    // undici's timeout wheel ticks about once a second, so the control needs a
    // stall comfortably above one tick for its 500ms bodyTimeout to fire.
    const control = buildNoTimeoutFetch(new Agent({ headersTimeout: 500, bodyTimeout: 500 }))
    const res = await control(`${baseUrl}/?stall=2500`)
    await expect(res.text()).rejects.toThrow(/terminated/i)
  }, 10000)

  it('survives a mid-body stall longer than the control timeout', async () => {
    const fetchNoTimeout = buildNoTimeoutFetch()
    const res = await fetchNoTimeout(`${baseUrl}/?stall=${STALL_MS}`)
    await expect(res.text()).resolves.toBe('hello world')
  })

  it('accepts a native Request input with a body (SDK OM calls fetch(new Request(...)))', async () => {
    // Node's native Request fails the npm undici package's brand check and used
    // to be stringified into `new URL()` → "Failed to parse URL from [object Request]".
    const fetchNoTimeout = buildNoTimeoutFetch()
    const res = await fetchNoTimeout(
      new Request(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'x-test': 'yes' },
        body: 'ping'
      })
    )
    await expect(res.text()).resolves.toBe('POST|yes|ping')
  })

  it('accepts a bodyless GET Request input', async () => {
    const fetchNoTimeout = buildNoTimeoutFetch()
    const res = await fetchNoTimeout(new Request(`${baseUrl}/?stall=50`))
    await expect(res.text()).resolves.toBe('hello world')
  })

  it('still honors AbortSignal mid-stall', async () => {
    const fetchNoTimeout = buildNoTimeoutFetch()
    const controller = new AbortController()
    const res = await fetchNoTimeout(`${baseUrl}/?stall=5000`, { signal: controller.signal })
    const read = res.text()
    await delay(50)
    controller.abort()
    await expect(read).rejects.toThrow()
  })
})
