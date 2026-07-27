/**
 * Tripwire tests for the reimplemented SDK OAuth-token fingerprint: the
 * known vectors below were computed with the bundled SDK's own algorithm
 * (@mastra/code-sdk dist/mcp/manager.js getStorageKeyFingerprint). If these
 * fail after a runtime bump, the SDK changed its storage scheme and
 * mcp-oauth-mirror.ts must be re-verified against the new dist source.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mirrorMcpOAuthTokens,
  oauthStorageKey,
  oauthTokenDir,
  storageKeyFingerprint
} from './mcp-oauth-mirror'

describe('storageKeyFingerprint', () => {
  it('matches the SDK vector for a server without explicit oauth config', () => {
    const key = oauthStorageKey('/tmp/proj', 'github', {
      url: 'https://api.githubcopilot.com/mcp/'
    })
    expect(key).toBe(
      '{"projectDir":"/tmp/proj","name":"github","url":"https://api.githubcopilot.com/mcp/",' +
        '"redirectUrl":"http://127.0.0.1:1458/oauth/callback","scopes":[]}'
    )
    expect(storageKeyFingerprint(key)).toBe('0e8d191f39242140')
  })

  it('matches the SDK vector for a server with callbackPort, clientId and scopes', () => {
    const key = oauthStorageKey('/tmp/proj', 'sentry', {
      url: 'https://mcp.sentry.dev/mcp',
      oauth: { callbackPort: 9876, clientId: 'abc123', scopes: ['read', 'write'] }
    })
    expect(key).toBe(
      '{"projectDir":"/tmp/proj","name":"sentry","url":"https://mcp.sentry.dev/mcp",' +
        '"redirectUrl":"http://localhost:9876/callback","clientId":"abc123","scopes":["read","write"]}'
    )
    expect(storageKeyFingerprint(key)).toBe('f79ff4015f7f3704')
  })

  it('uses an explicit redirectUrl when no callbackPort is set', () => {
    const key = oauthStorageKey('/p', 's', {
      url: 'https://x.example/mcp',
      oauth: { redirectUrl: 'http://127.0.0.1:7777/cb' }
    })
    expect(key).toContain('"redirectUrl":"http://127.0.0.1:7777/cb"')
  })
})

describe('mirrorMcpOAuthTokens', () => {
  let tmpRoot: string
  let savedAppDataDir: string | undefined

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yardarm-oauth-mirror-'))
    savedAppDataDir = process.env.MASTRA_APP_DATA_DIR
    process.env.MASTRA_APP_DATA_DIR = path.join(tmpRoot, 'appdata')
  })

  afterEach(async () => {
    if (savedAppDataDir === undefined) delete process.env.MASTRA_APP_DATA_DIR
    else process.env.MASTRA_APP_DATA_DIR = savedAppDataDir
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  const writeProjectMcpJson = async (dir: string): Promise<void> => {
    await fs.mkdir(path.join(dir, '.mastracode'), { recursive: true })
    await fs.writeFile(
      path.join(dir, '.mastracode', 'mcp.json'),
      JSON.stringify({
        mcpServers: { 'yardarm-test-server': { url: 'https://mcp.test.example/mcp' } }
      })
    )
  }

  it('copies the token file onto sibling cwd fingerprints', async () => {
    const dirA = path.join(tmpRoot, 'a')
    const dirB = path.join(tmpRoot, 'b')
    await writeProjectMcpJson(dirA)
    await writeProjectMcpJson(dirB)

    const cfg = { url: 'https://mcp.test.example/mcp' }
    const tokenDir = oauthTokenDir()
    const fileA = path.join(
      tokenDir,
      `${storageKeyFingerprint(oauthStorageKey(dirA, 'yardarm-test-server', cfg))}.json`
    )
    const fileB = path.join(
      tokenDir,
      `${storageKeyFingerprint(oauthStorageKey(dirB, 'yardarm-test-server', cfg))}.json`
    )
    await fs.mkdir(tokenDir, { recursive: true })
    await fs.writeFile(fileA, '{"tokens":{"access_token":"tok"}}')

    const copies = await mirrorMcpOAuthTokens([dirA, dirB])
    expect(copies).toBe(1)
    expect(await fs.readFile(fileB, 'utf8')).toBe('{"tokens":{"access_token":"tok"}}')

    // Second pass is a no-op: contents already match.
    expect(await mirrorMcpOAuthTokens([dirA, dirB])).toBe(0)
  })

  it('does nothing when no token file exists in the group', async () => {
    const dirA = path.join(tmpRoot, 'a')
    const dirB = path.join(tmpRoot, 'b')
    await writeProjectMcpJson(dirA)
    await writeProjectMcpJson(dirB)
    expect(await mirrorMcpOAuthTokens([dirA, dirB])).toBe(0)
  })
})
