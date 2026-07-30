import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePackEntry } from './lsp-pack-resolve'

const PKG = 'yaml-language-server'
const SUB = 'bin/yaml-language-server'

let root: string

/** Creates <root>/<packId>/<version> with optional pack.json and entry file. */
function install(version: string, opts: { manifest?: boolean; entry?: boolean } = {}): void {
  const { manifest = true, entry = true } = opts
  const dir = path.join(root, 'yaml', version)
  mkdirSync(path.join(dir, 'node_modules', PKG, 'bin'), { recursive: true })
  if (manifest) writeFileSync(path.join(dir, 'pack.json'), '{}')
  if (entry) writeFileSync(path.join(dir, 'node_modules', PKG, SUB), '')
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'lsp-pack-resolve-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolvePackEntry', () => {
  it('returns undefined when nothing is installed', () => {
    expect(resolvePackEntry(root, 'yaml', PKG, SUB, '1.24.0')).toBeUndefined()
  })

  it('resolves the preferred (pinned) version when complete', () => {
    install('1.24.0')
    install('9.9.9')
    expect(resolvePackEntry(root, 'yaml', PKG, SUB, '1.24.0')).toBe(
      path.join(root, 'yaml', '1.24.0', 'node_modules', PKG, SUB)
    )
  })

  it('falls back to the newest complete install when the pin is absent', () => {
    install('1.22.0')
    install('1.23.0')
    expect(resolvePackEntry(root, 'yaml', PKG, SUB, '1.24.0')).toBe(
      path.join(root, 'yaml', '1.23.0', 'node_modules', PKG, SUB)
    )
  })

  it('orders versions numerically, not lexically', () => {
    install('1.2.9')
    install('1.2.10')
    expect(resolvePackEntry(root, 'yaml', PKG, SUB, '9.9.9')).toBe(
      path.join(root, 'yaml', '1.2.10', 'node_modules', PKG, SUB)
    )
  })

  it('ignores installs without a pack.json manifest (incomplete)', () => {
    install('1.24.0', { manifest: false })
    expect(resolvePackEntry(root, 'yaml', PKG, SUB, '1.24.0')).toBeUndefined()
  })

  it('ignores installs missing the entry file', () => {
    install('1.24.0', { entry: false })
    install('1.23.0')
    expect(resolvePackEntry(root, 'yaml', PKG, SUB, '1.24.0')).toBe(
      path.join(root, 'yaml', '1.23.0', 'node_modules', PKG, SUB)
    )
  })

  it('skips in-progress *.tmp-* directories', () => {
    const tmp = path.join(root, 'yaml', 'dir.tmp-123')
    mkdirSync(path.join(tmp, 'node_modules', PKG, 'bin'), { recursive: true })
    writeFileSync(path.join(tmp, 'pack.json'), '{}')
    writeFileSync(path.join(tmp, 'node_modules', PKG, SUB), '')
    expect(resolvePackEntry(root, 'yaml', PKG, SUB, '1.24.0')).toBeUndefined()
  })
})
