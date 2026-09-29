/**
 * Tests for the dashboard-serving health helpers: bare-API vs SPA response
 * classification, UI-dist status derivation, and the MASTRACODE_UI_DIST
 * remediation write against the template's commented-out key.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { classifyDashboardResponse, deriveUiDistStatus, inspectUiDist } from './dashboard-health'
import { parseEnvFile, serializeEnvFile, upsertEnv } from './env-file'
import { updateEnvFile } from './factory-dir'

const tmpDirs: string[] = []

async function makeDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yardarm-dash-health-'))
  tmpDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  }
  return dir
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe('classifyDashboardResponse', () => {
  it('flags the bare Hono default in a JSON body', () => {
    expect(
      classifyDashboardResponse({
        contentType: 'application/json',
        body: '{"message":"Welcome to the Mastra API"}'
      })
    ).toBe('bare_api')
  })

  it('flags the marker in a plain-text body', () => {
    expect(
      classifyDashboardResponse({ contentType: 'text/plain', body: 'Welcome to the Mastra API' })
    ).toBe('bare_api')
  })

  it('matches the marker case-insensitively', () => {
    expect(classifyDashboardResponse({ contentType: '', body: 'WELCOME TO THE MASTRA API' })).toBe(
      'bare_api'
    )
  })

  it('treats HTML with the Factory title as the SPA', () => {
    expect(
      classifyDashboardResponse({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><title>Mastra Factory</title></head></html>'
      })
    ).toBe('spa')
  })

  it('treats any HTML as the SPA (no false nag on retitled dashboards)', () => {
    expect(
      classifyDashboardResponse({
        contentType: 'text/html',
        body: '<html><body><div id="app"></div></body></html>'
      })
    ).toBe('spa')
  })

  it('detects HTML from the body when the content type is missing', () => {
    expect(
      classifyDashboardResponse({ contentType: '', body: '  <!DOCTYPE html><html></html>' })
    ).toBe('spa')
  })

  it('returns unknown for non-HTML bodies without the marker', () => {
    expect(
      classifyDashboardResponse({ contentType: 'application/json', body: '{"ok":true}' })
    ).toBe('unknown')
    expect(classifyDashboardResponse({ contentType: '', body: '' })).toBe('unknown')
  })
})

describe('deriveUiDistStatus', () => {
  const dir = '/checkout'
  const bundled = path.join(dir, 'node_modules', 'mastra', 'dist', 'factory')
  const built = path.join(dir, 'src', 'mastra', 'public', 'factory')

  it('is valid (no fix) when the env value points at an existing index', () => {
    const s = deriveUiDistStatus({
      dir,
      envValue: bundled,
      envIndexExists: true,
      bundledIndexExists: true,
      builtIndexExists: false
    })
    expect(s.envValid).toBe(true)
    expect(s.fixAvailable).toBe(false)
  })

  it('offers the fix when the env value is stale but the bundle exists', () => {
    const s = deriveUiDistStatus({
      dir,
      envValue: '/moved/away',
      envIndexExists: false,
      bundledIndexExists: true,
      builtIndexExists: false
    })
    expect(s.envValid).toBe(false)
    expect(s.fixAvailable).toBe(true)
    expect(s.bundledDir).toBe(bundled)
  })

  it('offers the fix when the key is unset and the bundle exists', () => {
    const s = deriveUiDistStatus({
      dir,
      envValue: null,
      envIndexExists: false,
      bundledIndexExists: true,
      builtIndexExists: false
    })
    expect(s.envValue).toBeNull()
    expect(s.fixAvailable).toBe(true)
  })

  it('treats a whitespace env value as unset', () => {
    const s = deriveUiDistStatus({
      dir,
      envValue: '   ',
      envIndexExists: false,
      bundledIndexExists: true,
      builtIndexExists: false
    })
    expect(s.envValue).toBeNull()
    expect(s.fixAvailable).toBe(true)
  })

  it('reports the built dir but no fix when only mastra build output exists', () => {
    const s = deriveUiDistStatus({
      dir,
      envValue: null,
      envIndexExists: false,
      bundledIndexExists: false,
      builtIndexExists: true
    })
    expect(s.fixAvailable).toBe(false)
    expect(s.bundledDir).toBeNull()
    expect(s.builtDir).toBe(built)
  })

  it('reports nothing when no candidate exists', () => {
    const s = deriveUiDistStatus({
      dir,
      envValue: null,
      envIndexExists: false,
      bundledIndexExists: false,
      builtIndexExists: false
    })
    expect(s).toEqual({
      envValue: null,
      envValid: false,
      bundledDir: null,
      builtDir: null,
      fixAvailable: false
    })
  })
})

describe('inspectUiDist', () => {
  it('finds the bundled SPA and ignores the commented template key', async () => {
    const dir = await makeDir({
      '.env': '# MASTRACODE_UI_DIST=\nPORT=4111\n',
      'node_modules/mastra/dist/factory/index.html': '<!doctype html>'
    })
    const s = await inspectUiDist(dir)
    expect(s.envValue).toBeNull()
    expect(s.fixAvailable).toBe(true)
    expect(s.bundledDir).toBe(path.join(dir, 'node_modules', 'mastra', 'dist', 'factory'))
  })

  it('validates a relative env value against the checkout dir', async () => {
    const dir = await makeDir({
      '.env': 'MASTRACODE_UI_DIST=custom-ui\n',
      'custom-ui/index.html': '<!doctype html>'
    })
    const s = await inspectUiDist(dir)
    expect(s.envValid).toBe(true)
    expect(s.fixAvailable).toBe(false)
  })
})

describe('MASTRACODE_UI_DIST remediation write', () => {
  it('appends an uncommented pair, preserves the comment, and is idempotent', async () => {
    const original = '# Factory server env\n# MASTRACODE_UI_DIST=\nPORT=4111\n'
    const dir = await makeDir({ '.env': original })
    const value = path.join(dir, 'node_modules', 'mastra', 'dist', 'factory')

    await updateEnvFile(dir, (lines) => upsertEnv(lines, { MASTRACODE_UI_DIST: value }))
    const once = await fs.readFile(path.join(dir, '.env'), 'utf8')
    expect(once).toBe(`${original}MASTRACODE_UI_DIST=${value}\n`)

    // Second run edits the (now present) pair in place — byte-identical.
    await updateEnvFile(dir, (lines) => upsertEnv(lines, { MASTRACODE_UI_DIST: value }))
    expect(await fs.readFile(path.join(dir, '.env'), 'utf8')).toBe(once)

    // The commented template line survives the round-trip untouched.
    const lines = parseEnvFile(once)
    expect(serializeEnvFile(lines)).toContain('# MASTRACODE_UI_DIST=\n')
  })
})
