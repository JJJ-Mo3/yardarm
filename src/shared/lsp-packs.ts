/**
 * Catalog of optional downloadable language-server packs.
 *
 * The packaged app bundles only the TypeScript/JavaScript server; the packs
 * below are built as per-pack zip assets on each GitHub release
 * (scripts/build-lsp-packs.mjs) and downloaded on demand into
 * <userData>/lsp-servers/<packId>/<version>/ (src/main/lib/lsp-packs).
 * Go/Rust/Ruby diagnostics use external toolchain binaries and are not packs.
 *
 * `version` must match the exact package.json devDependencies pin — the
 * vitest tripwire in lsp-packs.test.ts enforces this, because the pin is what
 * dev mode resolves and what scripts/build-lsp-packs.mjs stages into the
 * release assets.
 *
 * Pack ids must never contain mac/darwin/arm64/x64: the updater's loose
 * fallback asset matchers (pickMacZipAsset) must never select a pack zip.
 */
export type LspPackId = 'web' | 'yaml' | 'python' | 'erb'

export interface LspPackDef {
  id: LspPackId
  /** Display name, e.g. 'Web (HTML/CSS/JSON)'. */
  name: string
  /** Languages covered, for display. */
  languages: string[]
  /** npm package staged into the pack zip. */
  pkg: string
  /** Exact version — must equal the package.json devDependencies pin. */
  version: string
  /** Approximate download (zip) size, for download buttons. */
  approxSizeMb: number
}

export const LSP_PACKS: LspPackDef[] = [
  {
    id: 'web',
    name: 'Web (HTML/CSS/JSON)',
    languages: ['HTML', 'CSS/SCSS/Less', 'JSON'],
    pkg: 'vscode-langservers-extracted',
    version: '4.10.0',
    approxSizeMb: 15
  },
  {
    id: 'yaml',
    name: 'YAML',
    languages: ['YAML'],
    pkg: 'yaml-language-server',
    version: '1.24.0',
    approxSizeMb: 6
  },
  {
    id: 'python',
    name: 'Python',
    languages: ['Python'],
    pkg: 'pyright',
    version: '1.1.411',
    approxSizeMb: 7
  },
  {
    id: 'erb',
    name: 'ERB / Rails templates',
    languages: ['ERB'],
    pkg: '@herb-tools/language-server',
    version: '0.10.2',
    approxSizeMb: 19
  }
]

/** Release asset filename for a pack (platform-independent zip). */
export function packAssetName(pack: LspPackDef): string {
  return `lsp-pack-${pack.id}-${pack.version}.zip`
}
