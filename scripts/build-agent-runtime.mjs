/**
 * Stage a self-contained mastracode runtime for packaging.
 *
 * electron-builder's pnpm dependency walker mis-links the multi-version
 * @ai-sdk/* packages in our hoisted tree (e.g. it nests provider-utils@3.0.30
 * under @ai-sdk/openai, which needs 4.0.40), breaking `import('mastracode')`
 * in the packaged app. Instead of shipping the walker's broken tree to the
 * agent host, we npm-install mastracode into vendor/agent-runtime (npm builds
 * a correct nested tree) and ship it via extraResources as
 * Resources/agent-runtime. The agent host imports mastracode from there when
 * packaged (HostBootConfig.agentRuntimePath).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const stageDir = join(root, 'vendor', 'agent-runtime')

const appPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// mastracode lives in devDependencies: only the staged runtime ships in the
// app; the asar must not carry the walker's broken copy of the tree.
const version = (name) => appPkg.dependencies?.[name] ?? appPkg.devDependencies?.[name]
const deps = {
  mastracode: version('mastracode'),
  '@mastra/code-sdk': version('@mastra/code-sdk')
}
for (const [name, v] of Object.entries(deps)) {
  if (!v) {
    console.error(`[agent-runtime] ${name} not found in package.json`)
    process.exit(1)
  }
}

function stagedVersion(name) {
  try {
    return JSON.parse(readFileSync(join(stageDir, 'node_modules', name, 'package.json'), 'utf8'))
      .version
  } catch {
    return null
  }
}

if (Object.entries(deps).every(([name, version]) => stagedVersion(name) === version)) {
  console.log(`[agent-runtime] up to date (mastracode ${deps.mastracode})`)
  process.exit(0)
}

console.log(`[agent-runtime] staging mastracode ${deps.mastracode} in vendor/agent-runtime ...`)
mkdirSync(stageDir, { recursive: true })
writeFileSync(
  join(stageDir, 'package.json'),
  JSON.stringify({ name: 'yardarm-agent-runtime', private: true, dependencies: deps }, null, 2)
)

const result = spawnSync(
  'npm',
  ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'],
  { cwd: stageDir, stdio: 'inherit', shell: process.platform === 'win32' }
)
if (result.status !== 0) {
  console.error('[agent-runtime] npm install failed')
  process.exit(result.status ?? 1)
}
console.log('[agent-runtime] staged successfully')
