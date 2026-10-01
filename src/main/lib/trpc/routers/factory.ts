/**
 * Factory harness router — scaffold, configure, and run a Mastra Factory
 * server checkout (mastra.ai/factory) from the Factory tab.
 *
 * All process work runs in app-level singleton ptys (`factory-*` ids) so the
 * renderer can attach interactive terminals via the generic terminal router;
 * commands are always built server-side (the renderer never passes command
 * strings). `ptyManager.exists` doubles as the running-state check because a
 * command pty ends when its command exits (same pattern as Preview's dev
 * servers). The .env file is edited through the lossless queued-atomic
 * helpers in lib/factory.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { FactoryConfig, FactoryMode } from '../../../../shared/ipc-types'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { getDb, schema } from '../../db'
import { deriveAuthPlan } from '../../factory/auth-plan'
import { ensureUiDist, inspectUiDist } from '../../factory/dashboard-health'
import { probeDockerStatus, probeTcp, runtimeStartCommand } from '../../factory/docker-status'
import { getEnv, listEnv, upsertEnv } from '../../factory/env-file'
import { probeDashboard } from '../../factory/factory-client'
import { factoryPortFromDir, reclaimPort } from '../../factory/port-reclaim'
import {
  deriveComposeDatabaseUrl,
  inspectFactoryDir,
  missingRequiredKeys,
  parseDatabaseUrlTarget,
  readEnvLines,
  readExampleEnv,
  updateEnvFile
} from '../../factory/factory-dir'
import { ptyManager, shellQuote } from '../../terminal/pty-manager'
import { publicProcedure, router } from '../trpc'

const SERVER_ID = 'factory-server'
const SCAFFOLD_ID = 'factory-scaffold'
const DB_ID = 'factory-db'
const INSTALL_ID = 'factory-install'

/**
 * Port the .env designated when the server pty was last started. The running
 * server holds its boot-time port even if PORT changes afterwards, so stop /
 * restart reclaim this in addition to the current .env port.
 */
let lastServerPort: number | null = null

/** Kill the server pty and make sure its port(s) are actually released. */
async function stopServerAndReclaim(dir: string): Promise<void> {
  ptyManager.kill(SERVER_ID)
  const ports = new Set<number>()
  if (lastServerPort !== null) ports.add(lastServerPort)
  ports.add(await factoryPortFromDir(dir))
  for (const port of ports) await reclaimPort(port)
  lastServerPort = null
}

const CONFIG_KEY = 'factory'
const modeSchema = z.enum(['platform', 'local'])
/**
 * Same key charset as env-file's PAIR_RE (dotenv-style names allow `.`/`-`)
 * — stricter would reject edits to keys already present in a real .env.
 */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/

function readConfig(): FactoryConfig {
  const row = getDb()
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, CONFIG_KEY))
    .get()
  let parsed: unknown = null
  try {
    parsed = row ? (JSON.parse(row.value) as unknown) : null
  } catch {}
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as {
    dir?: unknown
    mode?: unknown
  }
  return {
    dir: typeof obj.dir === 'string' && obj.dir ? obj.dir : null,
    mode: obj.mode === 'local' ? 'local' : 'platform'
  }
}

function writeConfig(config: FactoryConfig): void {
  const db = getDb()
  const value = JSON.stringify(config)
  const existing = db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, CONFIG_KEY))
    .get()
  if (existing) {
    db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, CONFIG_KEY)).run()
  } else {
    db.insert(schema.appSettings).values({ key: CONFIG_KEY, value }).run()
  }
}

/**
 * .env.example defaults augmented with the compose-derived local DATABASE_URL
 * — the template ships DATABASE_URL commented out, so the only machine-readable
 * default for it lives in docker-compose.yml.
 */
async function exampleDefaults(dir: string): Promise<Record<string, string>> {
  const example = await readExampleEnv(dir)
  if (!example.DATABASE_URL?.trim()) {
    const composeUrl = await deriveComposeDatabaseUrl(dir)
    if (composeUrl) example.DATABASE_URL = composeUrl
  }
  return example
}

/** Mode-aware inspection + required-key gaps for one Factory dir. */
async function inspectWithEnv(
  dir: string,
  mode?: FactoryMode
): Promise<{
  dirExists: boolean
  scaffolded: boolean
  hasEnv: boolean
  hasEnvExample: boolean
  hasNodeModules: boolean
  hasDockerCompose: boolean
  hasDbScript: boolean
  detectedMode: 'platform' | 'local' | 'unknown'
  missingRequired: string[]
}> {
  const inspection = await inspectFactoryDir(dir)
  const effectiveMode: FactoryMode =
    mode ?? (inspection.detectedMode === 'unknown' ? 'platform' : inspection.detectedMode)
  const { lines } = await readEnvLines(dir)
  return { ...inspection, missingRequired: missingRequiredKeys(listEnv(lines), effectiveMode) }
}

export const factoryRouter = router({
  getConfig: publicProcedure.query(() => readConfig()),

  setConfig: publicProcedure
    .input(z.object({ dir: z.string().nullable().optional(), mode: modeSchema.optional() }))
    .mutation(({ input }) => {
      const config = readConfig()
      if (input.dir !== undefined) config.dir = input.dir
      if (input.mode !== undefined) config.mode = input.mode
      writeConfig(config)
      return config
    }),

  inspect: publicProcedure
    .input(z.object({ dir: z.string().min(1), mode: modeSchema.optional() }))
    .query(({ input }) => inspectWithEnv(input.dir, input.mode)),

  /**
   * Run `npm create factory@latest` in the target's parent directory, in an
   * interactive pty (the installer prompts; platform mode runs a browser
   * sign-in flow). Completion = pty exit + re-inspect, not output parsing.
   */
  scaffold: publicProcedure
    .input(z.object({ dir: z.string().min(1), mode: modeSchema }))
    .mutation(async ({ input }) => {
      if (ptyManager.exists(SERVER_ID)) throw new Error('Stop the Factory server first')
      if (ptyManager.exists(SCAFFOLD_ID)) throw new Error('A scaffold is already running')
      const dir = path.resolve(input.dir)
      const parent = path.dirname(dir)
      const name = path.basename(dir)
      if (!name || parent === dir) throw new Error('Choose a folder inside an existing directory')
      const parentStat = await fs.stat(parent).catch(() => null)
      if (!parentStat?.isDirectory()) throw new Error(`Parent folder does not exist: ${parent}`)
      const existing = await fs.stat(dir).catch(() => null)
      if (existing) {
        if (!existing.isDirectory()) throw new Error(`${dir} exists and is not a directory`)
        const entries = (await fs.readdir(dir)).filter((e) => e !== '.DS_Store')
        if (entries.length > 0) throw new Error(`${dir} is not empty`)
      }
      const flags = input.mode === 'local' ? ' -- --no-platform' : ''
      ptyManager.create(
        SCAFFOLD_ID,
        parent,
        80,
        24,
        `npm create factory@latest ${shellQuote(name)}${flags}`
      )
      return { ok: true }
    }),

  install: publicProcedure.input(z.object({ dir: z.string().min(1) })).mutation(({ input }) => {
    if (ptyManager.exists(INSTALL_ID)) throw new Error('An install is already running')
    ptyManager.create(INSTALL_ID, input.dir, 80, 24, 'npm install')
    return { ok: true }
  }),

  envRead: publicProcedure
    .input(z.object({ dir: z.string().min(1), mode: modeSchema.optional() }))
    .query(async ({ input }) => {
      const { exists, lines } = await readEnvLines(input.dir)
      const entries: { key: string; value: string }[] = []
      for (const line of lines) {
        if (line.kind === 'pair') entries.push({ key: line.key, value: line.value })
      }
      const inspection = await inspectFactoryDir(input.dir)
      const mode: FactoryMode =
        input.mode ?? (inspection.detectedMode === 'unknown' ? 'platform' : inspection.detectedMode)
      const example = await exampleDefaults(input.dir)
      return {
        exists,
        entries,
        exampleKeys: Object.keys(example),
        /** Template defaults (.env.example + compose-derived DATABASE_URL). */
        exampleValues: example,
        missingRequired: missingRequiredKeys(listEnv(lines), mode),
        /** Which sign-in method the scaffold's auth ladder will pick. */
        authPlan: deriveAuthPlan(listEnv(lines))
      }
    }),

  envWrite: publicProcedure
    .input(
      z.object({
        dir: z.string().min(1),
        updates: z.record(z.string().regex(ENV_KEY_RE), z.string())
      })
    )
    .mutation(async ({ input }) => {
      await updateEnvFile(input.dir, (lines) => upsertEnv(lines, input.updates))
      return { ok: true }
    }),

  /** Generate FACTORY_CREDENTIAL_ENCRYPTION_KEY (32 random bytes, base64); no-op if set. */
  envGenerateEncryptionKey: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      let generated = false
      await updateEnvFile(input.dir, (lines) => {
        if (getEnv(lines, 'FACTORY_CREDENTIAL_ENCRYPTION_KEY')?.trim()) return lines
        generated = true
        return upsertEnv(lines, {
          FACTORY_CREDENTIAL_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64')
        })
      })
      return { generated }
    }),

  /**
   * Copy the model-provider API keys Yardarm already injects into agent hosts
   * (env-var mappings + login-shell auto-detect) into Factory's .env. Only
   * absent/empty keys are written — user values are never overwritten.
   */
  envSeedProviderKeys: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const available = agentSessionManager.buildProviderKeyEnv()
      const seeded: string[] = []
      await updateEnvFile(input.dir, (lines) => {
        const updates: Record<string, string> = {}
        for (const [name, value] of Object.entries(available)) {
          if (!getEnv(lines, name)?.trim()) {
            updates[name] = value
            seeded.push(name)
          }
        }
        return upsertEnv(lines, updates)
      })
      return { seeded }
    }),

  /**
   * Copy .env.example's non-empty default values (plus the compose-derived
   * DATABASE_URL) into absent/empty .env keys. Never overwrites user values.
   */
  envSeedExampleDefaults: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const example = await exampleDefaults(input.dir)
      const seeded: string[] = []
      await updateEnvFile(input.dir, (lines) => {
        const updates: Record<string, string> = {}
        for (const [name, value] of Object.entries(example)) {
          if (value.trim() && !getEnv(lines, name)?.trim()) {
            updates[name] = value
            seeded.push(name)
          }
        }
        return upsertEnv(lines, updates)
      })
      return { seeded }
    }),

  /** CLI presence + daemon reachability + compose plugin + startable runtime. */
  dockerStatus: publicProcedure.query(() => probeDockerStatus()),

  /**
   * Bring the detected Docker runtime's daemon up (open Docker Desktop /
   * OrbStack, or `colima start`) in the database pty so its output is
   * visible in the card's terminal. The renderer polls dockerStatus while
   * unhealthy, so the banner clears once the daemon answers.
   */
  dockerStartRuntime: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (ptyManager.exists(DB_ID)) throw new Error('A database command is already running')
      const status = await probeDockerStatus()
      if (status.daemonRunning) return { ok: true }
      if (!status.runtime) throw new Error('No startable Docker runtime found')
      ptyManager.create(DB_ID, input.dir, 80, 24, runtimeStartCommand(status.runtime.id))
      return { ok: true }
    }),

  /**
   * Is anything listening on the .env DATABASE_URL's host:port? Localhost
   * targets only (remote databases are never probed) — powers the
   * "database unreachable" warning shown before starting the server, which
   * otherwise crashes with a bare ECONNREFUSED.
   */
  dbReachable: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .query(async ({ input }) => {
      const { lines } = await readEnvLines(input.dir)
      const url = getEnv(lines, 'DATABASE_URL')?.trim()
      const target = url ? parseDatabaseUrlTarget(url) : null
      if (!target?.local) {
        return { checked: false, reachable: true, host: null, port: null }
      }
      const host = target.host === '0.0.0.0' ? '127.0.0.1' : target.host
      const reachable = await probeTcp(host, target.port)
      return { checked: true, reachable, host: target.host, port: target.port }
    }),

  dbUp: publicProcedure.input(z.object({ dir: z.string().min(1) })).mutation(({ input }) => {
    if (ptyManager.exists(DB_ID)) throw new Error('A database command is already running')
    ptyManager.create(DB_ID, input.dir, 80, 24, 'npm run db:up')
    return { ok: true }
  }),

  dbDown: publicProcedure.input(z.object({ dir: z.string().min(1) })).mutation(({ input }) => {
    if (ptyManager.exists(DB_ID)) throw new Error('A database command is already running')
    ptyManager.create(DB_ID, input.dir, 80, 24, 'npm run db:down')
    return { ok: true }
  }),

  /**
   * Start the server pty after reclaiming its port: `mastra factory dev`
   * spawns the real server as a grandchild, and a stale one leaked from an
   * earlier session would otherwise silently front the new start. The
   * UI-dist preflight runs before the boot that reads .env so a fresh start
   * can never land on the bare "Welcome to the Mastra API" screen.
   */
  serverStart: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (ptyManager.exists(SERVER_ID)) throw new Error('The Factory server is already running')
      const port = await factoryPortFromDir(input.dir)
      await reclaimPort(port)
      await ensureUiDist(input.dir)
      ptyManager.create(SERVER_ID, input.dir, 80, 24, 'npm run dev')
      lastServerPort = port
      return { ok: true }
    }),

  serverStop: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await stopServerAndReclaim(input.dir)
      return { ok: true }
    }),

  /**
   * Stop + start the server pty. Needed because .env is only read at boot —
   * fixUiDist (and any other env change) takes effect on the next start.
   * The stop side verifies the port is actually released (killing leaked
   * node/mastra grandchildren if needed): killing only the pty shell can
   * orphan the real server, which then keeps serving with the stale env.
   */
  serverRestart: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await stopServerAndReclaim(input.dir)
      const port = await factoryPortFromDir(input.dir)
      await ensureUiDist(input.dir)
      ptyManager.create(SERVER_ID, input.dir, 80, 24, 'npm run dev')
      lastServerPort = port
      return { ok: true }
    }),

  /** Where a servable dashboard UI dist lives for this checkout, if anywhere. */
  uiDist: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .query(({ input }) => inspectUiDist(input.dir)),

  /** Is the running server serving the dashboard SPA, or only its bare API? */
  dashboardProbe: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .query(({ input }) => probeDashboard(input.dir)),

  /**
   * One-click fix for the "Welcome to the Mastra API" failure mode: point
   * MASTRACODE_UI_DIST at the dashboard SPA bundled with the checkout's
   * mastra CLI (node_modules/mastra/dist/factory), and belt-and-braces copy
   * that SPA into src/mastra/public/factory — the server's zero-config
   * fallback path, which `mastra build` also stages for production. Never
   * overwrites a valid user env value; the copy is best-effort.
   */
  fixUiDist: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const status = await inspectUiDist(input.dir)
      if (!status.envValid && !status.bundledDir) {
        throw new Error(
          'The dashboard bundle is missing (node_modules/mastra/dist/factory) — install dependencies first'
        )
      }
      const { written, builtUiInstalled } = await ensureUiDist(input.dir)
      return {
        written,
        value: written ? status.bundledDir : status.envValue,
        builtUiInstalled,
        needsRestart: (written || builtUiInstalled) && ptyManager.exists(SERVER_ID)
      }
    }),

  status: publicProcedure.query(() => ({
    serverRunning: ptyManager.exists(SERVER_ID),
    scaffoldRunning: ptyManager.exists(SCAFFOLD_ID),
    dbRunning: ptyManager.exists(DB_ID),
    installRunning: ptyManager.exists(INSTALL_ID)
  }))
})
