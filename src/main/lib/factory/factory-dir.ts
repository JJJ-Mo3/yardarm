/**
 * Factory checkout inspection + queued atomic .env access.
 *
 * A "Factory dir" is a Mastra Factory server checkout scaffolded by
 * `npm create factory@latest` (platform mode) or `... -- --no-platform`
 * (local self-hosted mode). Inspection is filesystem-only and never throws
 * for missing paths; .env writes replicate the queued read-modify-write +
 * tmp+rename pattern from mastra-config/settings-json.ts because the file is
 * shared with Factory's own tooling.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FactoryMode } from '../../../shared/ipc-types'
import { listEnv, parseEnvFile, serializeEnvFile, type EnvLine } from './env-file'

export type DetectedFactoryMode = FactoryMode | 'unknown'

export interface FactoryDirInspection {
  dirExists: boolean
  /** package.json exists with a `dev` script (db:up is optional — platform scaffolds may lack it). */
  scaffolded: boolean
  hasEnv: boolean
  hasEnvExample: boolean
  hasNodeModules: boolean
  hasDockerCompose: boolean
  hasDbScript: boolean
  detectedMode: DetectedFactoryMode
}

/** Any of these present in .env identifies a platform-mode scaffold. */
const PLATFORM_CRED_KEYS = [
  'MASTRA_PLATFORM_ACCESS_TOKEN',
  'MASTRA_PLATFORM_SECRET_KEY',
  'MASTRA_SHARED_API_URL'
]

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

export async function inspectFactoryDir(dir: string): Promise<FactoryDirInspection> {
  const stat = await fs.stat(dir).catch(() => null)
  if (!stat?.isDirectory()) {
    return {
      dirExists: false,
      scaffolded: false,
      hasEnv: false,
      hasEnvExample: false,
      hasNodeModules: false,
      hasDockerCompose: false,
      hasDbScript: false,
      detectedMode: 'unknown'
    }
  }

  let scaffolded = false
  let hasDbScript = false
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    scaffolded = typeof pkg.scripts?.dev === 'string'
    hasDbScript = typeof pkg.scripts?.['db:up'] === 'string'
  } catch {}

  const [hasEnv, hasEnvExample, hasNodeModules, ...composeHits] = await Promise.all([
    exists(path.join(dir, '.env')),
    exists(path.join(dir, '.env.example')),
    exists(path.join(dir, 'node_modules')),
    ...COMPOSE_FILES.map((f) => exists(path.join(dir, f)))
  ])
  const hasDockerCompose = composeHits.some(Boolean)

  let env: Record<string, string> = {}
  if (hasEnv) {
    try {
      env = listEnv(parseEnvFile(await fs.readFile(path.join(dir, '.env'), 'utf8')))
    } catch {}
  }
  const hasPlatformCreds = PLATFORM_CRED_KEYS.some((k) => (env[k] ?? '').trim() !== '')
  let detectedMode: DetectedFactoryMode = 'unknown'
  if (hasPlatformCreds) detectedMode = 'platform'
  else if (env.FACTORY_SANDBOX_PROVIDER === 'local' || hasDockerCompose || hasDbScript)
    detectedMode = 'local'

  return {
    dirExists: true,
    scaffolded,
    hasEnv,
    hasEnvExample,
    hasNodeModules,
    hasDockerCompose,
    hasDbScript,
    detectedMode
  }
}

/**
 * Required-key floor per mode. Keys from .env.example are surfaced in the
 * editor as suggestions but deliberately NOT required — the template lists
 * optional integration credentials (Slack/Linear/Jira/...) that must not
 * block the run panel. Platform credentials satisfy either-of.
 */
export function missingRequiredKeys(env: Record<string, string>, mode: FactoryMode): string[] {
  const has = (k: string): boolean => (env[k] ?? '').trim() !== ''
  const missing: string[] = []
  if (!has('FACTORY_CREDENTIAL_ENCRYPTION_KEY')) missing.push('FACTORY_CREDENTIAL_ENCRYPTION_KEY')
  if (!has('DATABASE_URL')) missing.push('DATABASE_URL')
  if (
    mode === 'platform' &&
    !has('MASTRA_PLATFORM_ACCESS_TOKEN') &&
    !has('MASTRA_PLATFORM_SECRET_KEY')
  ) {
    missing.push('MASTRA_PLATFORM_ACCESS_TOKEN')
  }
  return missing
}

export async function readEnvLines(dir: string): Promise<{ exists: boolean; lines: EnvLine[] }> {
  try {
    const text = await fs.readFile(path.join(dir, '.env'), 'utf8')
    return { exists: true, lines: parseEnvFile(text) }
  } catch {
    return { exists: false, lines: [] }
  }
}

/** Key → value map from `.env.example` (values are the template's defaults). */
export async function readExampleEnv(dir: string): Promise<Record<string, string>> {
  try {
    const text = await fs.readFile(path.join(dir, '.env.example'), 'utf8')
    return listEnv(parseEnvFile(text))
  } catch {
    return {}
  }
}

/**
 * Best-effort local DATABASE_URL derived from the checkout's docker-compose
 * file. The Factory template ships `DATABASE_URL` commented out in
 * .env.example — the real connection string lives in the compose file, either
 * verbatim in its usage comment (`export DATABASE_URL=postgres://...`) or
 * reconstructible from the postgres service's port mapping + POSTGRES_*
 * defaults. Returns null when neither is found.
 */
export async function deriveComposeDatabaseUrl(dir: string): Promise<string | null> {
  for (const f of COMPOSE_FILES) {
    let text: string
    try {
      text = await fs.readFile(path.join(dir, f), 'utf8')
    } catch {
      continue
    }
    const documented = text.match(/DATABASE_URL=(postgres(?:ql)?:\/\/\S+)/)
    if (documented) return documented[1]
    const port = text.match(/['"]?(\d+):5432['"]?/)
    if (!port) continue
    const setting = (name: string, fallback: string): string => {
      // Matches `NAME: ${NAME:-default}` (compose var with default) or `NAME: literal`.
      const m = text.match(new RegExp(`${name}:\\s*(?:\\$\\{${name}:-([^}]+)\\}|([^\\s'"]+))`))
      return m ? (m[1] ?? m[2]) : fallback
    }
    const user = setting('POSTGRES_USER', 'postgres')
    const pass = setting('POSTGRES_PASSWORD', 'postgres')
    const db = setting('POSTGRES_DB', user)
    return `postgres://${user}:${pass}@localhost:${port[1]}/${db}`
  }
  return null
}

const envWriteQueues = new Map<string, Promise<unknown>>()

/**
 * Queued atomic read-modify-write of `<dir>/.env`. When the file is absent it
 * is seeded from `.env.example` (or created empty). The mutator receives the
 * freshly-parsed lines and returns the lines to write.
 */
export function updateEnvFile(
  dir: string,
  mutate: (lines: EnvLine[]) => EnvLine[]
): Promise<EnvLine[]> {
  const file = path.join(dir, '.env')
  const prev = envWriteQueues.get(file) ?? Promise.resolve()
  const task = prev.then(async () => {
    let text: string
    try {
      text = await fs.readFile(file, 'utf8')
    } catch {
      text = await fs.readFile(path.join(dir, '.env.example'), 'utf8').catch(() => '')
    }
    const next = mutate(parseEnvFile(text))
    const tmp = `${file}.tmp-${process.pid}`
    await fs.writeFile(tmp, serializeEnvFile(next), { mode: 0o600 })
    await fs.rename(tmp, file)
    return next
  })
  envWriteQueues.set(
    file,
    task.catch(() => {})
  )
  return task
}
