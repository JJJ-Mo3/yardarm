/**
 * Tests for the dashboard-serving health helpers: bare-API vs SPA response
 * classification, UI-dist status derivation, and the MASTRACODE_UI_DIST
 * remediation write against the template's commented-out key.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyDashboardResponse,
  deriveUiDistStatus,
  ensureUiDist,
  inspectUiDist,
  installBuiltUi
} from './dashboard-health'
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
    expect(s.servable).toBe(true)
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
    expect(s.servable).toBe(false)
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
    expect(s.servable).toBe(true)
  })

  it('is servable when both the env value and the built copy exist', () => {
    const s = deriveUiDistStatus({
      dir,
      envValue: bundled,
      envIndexExists: true,
      bundledIndexExists: true,
      builtIndexExists: true
    })
    expect(s.servable).toBe(true)
    expect(s.fixAvailable).toBe(false)
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
      fixAvailable: false,
      servable: false
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

describe('installBuiltUi', () => {
  it('copies the bundled SPA (nested files included) into src/mastra/public/factory', async () => {
    const dir = await makeDir({
      'node_modules/mastra/dist/factory/index.html': '<!doctype html>',
      'node_modules/mastra/dist/factory/assets/app.js': 'console.log(1)'
    })
    expect(await installBuiltUi(dir)).toEqual({ copied: true })
    const dest = path.join(dir, 'src', 'mastra', 'public', 'factory')
    expect(await fs.readFile(path.join(dest, 'index.html'), 'utf8')).toBe('<!doctype html>')
    expect(await fs.readFile(path.join(dest, 'assets', 'app.js'), 'utf8')).toBe('console.log(1)')
  })

  it('overwrites a stale copy idempotently', async () => {
    const dir = await makeDir({
      'node_modules/mastra/dist/factory/index.html': '<!doctype html><title>new</title>',
      'src/mastra/public/factory/index.html': '<!doctype html><title>old</title>'
    })
    expect(await installBuiltUi(dir)).toEqual({ copied: true })
    expect(await installBuiltUi(dir)).toEqual({ copied: true })
    const index = path.join(dir, 'src', 'mastra', 'public', 'factory', 'index.html')
    expect(await fs.readFile(index, 'utf8')).toBe('<!doctype html><title>new</title>')
  })

  it('reports copied: false without creating anything when the bundle is missing', async () => {
    const dir = await makeDir({ '.env': 'PORT=4111\n' })
    expect(await installBuiltUi(dir)).toEqual({ copied: false })
    await expect(fs.access(path.join(dir, 'src', 'mastra', 'public', 'factory'))).rejects.toThrow()
  })
})

describe('ensureUiDist', () => {
  it('writes MASTRACODE_UI_DIST and installs the built copy when env is unset', async () => {
    const dir = await makeDir({
      '.env': '# MASTRACODE_UI_DIST=\nPORT=4111\n',
      'node_modules/mastra/dist/factory/index.html': '<!doctype html>'
    })
    expect(await ensureUiDist(dir)).toEqual({ written: true, builtUiInstalled: true })
    const env = await fs.readFile(path.join(dir, '.env'), 'utf8')
    const bundled = path.join(dir, 'node_modules', 'mastra', 'dist', 'factory')
    expect(env).toContain(`MASTRACODE_UI_DIST=${bundled}\n`)
    const dest = path.join(dir, 'src', 'mastra', 'public', 'factory', 'index.html')
    expect(await fs.readFile(dest, 'utf8')).toBe('<!doctype html>')
  })

  it('leaves a valid env value untouched', async () => {
    const original = 'MASTRACODE_UI_DIST=custom-ui\nPORT=4111\n'
    const dir = await makeDir({
      '.env': original,
      'custom-ui/index.html': '<!doctype html>',
      'node_modules/mastra/dist/factory/index.html': '<!doctype html>'
    })
    expect(await ensureUiDist(dir)).toEqual({ written: false, builtUiInstalled: true })
    expect(await fs.readFile(path.join(dir, '.env'), 'utf8')).toBe(original)
  })

  it('does nothing (and does not throw) when the bundle is missing', async () => {
    const original = 'PORT=4111\n'
    const dir = await makeDir({ '.env': original })
    expect(await ensureUiDist(dir)).toEqual({ written: false, builtUiInstalled: false })
    expect(await fs.readFile(path.join(dir, '.env'), 'utf8')).toBe(original)
  })

  it('still writes the env fix when the built-copy install fails', async () => {
    const dir = await makeDir({
      '.env': 'PORT=4111\n',
      'node_modules/mastra/dist/factory/index.html': '<!doctype html>',
      // A file where the copy destination's parent dir must go → fs.cp fails.
      'src/mastra/public': 'not a directory'
    })
    expect(await ensureUiDist(dir)).toEqual({ written: true, builtUiInstalled: false })
    const env = await fs.readFile(path.join(dir, '.env'), 'utf8')
    expect(env).toContain('MASTRACODE_UI_DIST=')
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
