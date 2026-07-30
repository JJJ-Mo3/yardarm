/**
 * Build the optional language-server pack release assets.
 *
 * For each pack in the catalog (src/shared/lsp-packs.ts — ids/packages must
 * stay in sync, guarded by src/shared/lsp-packs.test.ts) this npm-installs
 * the single package into vendor/lsp-packs/<id>/ (self-contained node_modules
 * tree), writes a pack.json manifest marking the install complete, asserts
 * the server entry files the agent host spawns actually exist (build-time
 * tripwire against upstream layout changes), and zips the tree with
 * `ditto -c -k` into dist/lsp-packs/lsp-pack-<id>-<version>.zip — the asset
 * name src/main/lib/lsp-packs/pack-manager.ts looks up on GitHub releases.
 * Versions are read from package.json devDependencies (exact pins).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const appPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = (name) => appPkg.dependencies?.[name] ?? appPkg.devDependencies?.[name]

// id/pkg must match LSP_PACKS in src/shared/lsp-packs.ts; entries are the
// LSP_SERVERS `entry` sub-paths in src/main/agent-host/agent-host.ts.
const PACKS = [
  {
    id: 'web',
    pkg: 'vscode-langservers-extracted',
    entries: [
      'bin/vscode-html-language-server',
      'bin/vscode-css-language-server',
      'bin/vscode-json-language-server'
    ]
  },
  { id: 'yaml', pkg: 'yaml-language-server', entries: ['bin/yaml-language-server'] },
  { id: 'python', pkg: 'pyright', entries: ['langserver.index.js'] },
  { id: 'erb', pkg: '@herb-tools/language-server', entries: ['bin/herb-language-server'] }
]

const outDir = join(root, 'dist', 'lsp-packs')
mkdirSync(outDir, { recursive: true })

for (const pack of PACKS) {
  const pkgVersion = version(pack.pkg)
  if (!pkgVersion) {
    console.error(`[lsp-packs] ${pack.pkg} not found in package.json`)
    process.exit(1)
  }

  const workDir = join(root, 'vendor', 'lsp-packs', pack.id)
  console.log(`[lsp-packs] staging ${pack.id} (${pack.pkg}@${pkgVersion}) ...`)
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  writeFileSync(
    join(workDir, 'package.json'),
    JSON.stringify(
      {
        name: `yardarm-lsp-pack-${pack.id}`,
        private: true,
        dependencies: { [pack.pkg]: pkgVersion }
      },
      null,
      2
    )
  )

  const result = spawnSync(
    'npm',
    ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'],
    { cwd: workDir, stdio: 'inherit', shell: process.platform === 'win32' }
  )
  if (result.status !== 0) {
    console.error(`[lsp-packs] npm install failed for ${pack.id}`)
    process.exit(result.status ?? 1)
  }

  // Tripwire: the agent host spawns these exact files; fail the build (not
  // users at runtime) if an upstream release moved them.
  for (const entry of pack.entries) {
    const entryPath = join(workDir, 'node_modules', pack.pkg, entry)
    if (!existsSync(entryPath)) {
      console.error(`[lsp-packs] ${pack.id}: missing entry file ${pack.pkg}/${entry}`)
      process.exit(1)
    }
  }

  // pack.json marks the tree complete — the resolver ignores version dirs
  // without it, and the pack manager writes one for hand-rolled zips too.
  writeFileSync(
    join(workDir, 'pack.json'),
    JSON.stringify({ id: pack.id, pkg: pack.pkg, version: pkgVersion }, null, 2)
  )

  const zipPath = join(outDir, `lsp-pack-${pack.id}-${pkgVersion}.zip`)
  rmSync(zipPath, { force: true })
  // ditto -c -k without --keepParent zips the directory *contents*, so
  // extracting yields node_modules/ + pack.json at the target root — the
  // layout resolvePackEntry expects.
  const zip = spawnSync('ditto', ['-c', '-k', workDir, zipPath], { stdio: 'inherit' })
  if (zip.status !== 0) {
    console.error(`[lsp-packs] ditto failed for ${pack.id}`)
    process.exit(zip.status ?? 1)
  }
  console.log(`[lsp-packs] built ${zipPath}`)
}

console.log('[lsp-packs] all packs built')
