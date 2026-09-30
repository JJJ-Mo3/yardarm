/**
 * Tests for the port-reclaim helpers: lsof pid parsing, the reclaimable-command
 * safety valve, and port-release polling against a real TCP listener. The kill
 * escalation path is deliberately untested (it signals real processes).
 */
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { isReclaimableCommand, parseLsofPids, waitForPortRelease } from './port-reclaim'

describe('parseLsofPids', () => {
  it('parses one pid per line with a trailing newline', () => {
    expect(parseLsofPids('123\n456\n')).toEqual([123, 456])
  })

  it('skips blank and non-numeric lines', () => {
    expect(parseLsofPids('  123  \n\nabc\n45x\n789\n')).toEqual([123, 789])
  })

  it('returns [] for empty output', () => {
    expect(parseLsofPids('')).toEqual([])
    expect(parseLsofPids('\n')).toEqual([])
  })
})

describe('isReclaimableCommand', () => {
  it('accepts node running the built server entry', () => {
    expect(
      isReclaimableCommand('/usr/local/bin/node /Users/x/factory-server/.mastra/output/index.mjs')
    ).toBe(true)
  })

  it('accepts the mastra CLI via node_modules/.bin', () => {
    expect(
      isReclaimableCommand('node /Users/x/factory-server/node_modules/.bin/mastra factory dev')
    ).toBe(true)
  })

  it('accepts npm and shell wrappers of the dev script', () => {
    expect(isReclaimableCommand('npm run dev')).toBe(true)
    expect(isReclaimableCommand('sh -c mastra factory dev --dir src/mastra')).toBe(true)
    expect(isReclaimableCommand('npx mastra factory dev')).toBe(true)
  })

  it('rejects unrelated listeners', () => {
    expect(isReclaimableCommand('/usr/local/bin/postgres -D /usr/local/var/postgres')).toBe(false)
    expect(isReclaimableCommand('python3 -m http.server 4111')).toBe(false)
    expect(isReclaimableCommand('/Applications/Docker.app/Contents/MacOS/com.docker.backend')).toBe(
      false
    )
    expect(isReclaimableCommand('')).toBe(false)
  })

  it('does not match node as a substring of another word', () => {
    expect(isReclaimableCommand('/opt/nodenv-helper serve')).toBe(false)
  })
})

describe('waitForPortRelease', () => {
  async function listen(): Promise<{ port: number; close: () => Promise<void> }> {
    const server = net.createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as net.AddressInfo).port
    return {
      port,
      close: () => new Promise((resolve) => server.close(() => resolve()))
    }
  }

  it('returns true immediately when nothing listens on the port', async () => {
    const { port, close } = await listen()
    await close()
    expect(await waitForPortRelease(port, 0)).toBe(true)
  })

  it('returns false at the deadline while the port is held', async () => {
    const { port, close } = await listen()
    try {
      expect(await waitForPortRelease(port, 0)).toBe(false)
    } finally {
      await close()
    }
  })

  it('returns true once the listener closes mid-poll', async () => {
    const { port, close } = await listen()
    const pending = waitForPortRelease(port, 5000)
    setTimeout(() => void close(), 400)
    expect(await pending).toBe(true)
  })
})
