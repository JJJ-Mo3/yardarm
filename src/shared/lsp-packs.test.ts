/**
 * Tripwires for the optional language-server pack catalog. These guard the
 * cross-file invariants that make packs work: catalog versions must equal the
 * package.json pins (what dev mode resolves and what the release assets are
 * built from), the bundled agent runtime must not re-grow the pack packages,
 * the pack build script must cover the whole catalog, and pack ids must never
 * collide with the updater's loose mac-zip asset matching.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LSP_PACKS, packAssetName } from './lsp-packs'

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const appPkg = JSON.parse(read('../../package.json')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe('LSP pack catalog', () => {
  it('pins exactly the package.json devDependencies versions', () => {
    for (const pack of LSP_PACKS) {
      const pin = appPkg.dependencies?.[pack.pkg] ?? appPkg.devDependencies?.[pack.pkg]
      expect(pin, `${pack.pkg} must be pinned in package.json`).toBeDefined()
      // Exact pin (no ^/~): the pack zip must contain precisely this version.
      expect(pin).toBe(pack.version)
    }
  })

  it('never re-adds pack packages to the bundled agent runtime', () => {
    const script = read('../../scripts/build-agent-runtime.mjs')
    for (const pack of LSP_PACKS) {
      expect(script, `${pack.pkg} must not be staged into the agent runtime`).not.toContain(
        pack.pkg
      )
    }
    // The TS/JS server intentionally stays bundled.
    expect(script).toContain('typescript-language-server')
  })

  it('is fully covered by the pack build script', () => {
    const script = read('../../scripts/build-lsp-packs.mjs')
    for (const pack of LSP_PACKS) {
      expect(script).toContain(`'${pack.id}'`)
      expect(script).toContain(pack.pkg)
    }
  })

  it('keeps ids and asset names clear of the updater asset matchers', () => {
    // pickMacZipAsset falls back to any zip containing these substrings; a
    // pack asset must never be selectable as an app update.
    for (const pack of LSP_PACKS) {
      const name = packAssetName(pack).toLowerCase()
      for (const forbidden of ['mac', 'darwin', 'arm64', 'x64']) {
        expect(name).not.toContain(forbidden)
      }
      expect(name).toBe(`lsp-pack-${pack.id}-${pack.version}.zip`)
    }
  })

  it('has unique ids and packages', () => {
    expect(new Set(LSP_PACKS.map((p) => p.id)).size).toBe(LSP_PACKS.length)
    expect(new Set(LSP_PACKS.map((p) => p.pkg)).size).toBe(LSP_PACKS.length)
  })
})
