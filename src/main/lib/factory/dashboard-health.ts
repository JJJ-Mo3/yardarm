/**
 * Dashboard-serving health for the Factory harness.
 *
 * A Factory server whose SPA middleware failed to mount answers GET / with
 * the bare Hono default ("Welcome to the Mastra API") instead of the
 * dashboard — the server "works" but is unusable. The SPA is resolved from
 * MASTRACODE_UI_DIST (or a handful of fallback paths) at boot, and the
 * prebuilt bundle ships inside the checkout's mastra CLI at
 * node_modules/mastra/dist/factory. This module classifies what GET /
 * actually returned and inspects/derives where a usable UI dist lives so the
 * UI can offer a one-click .env fix. Pure helpers are Electron-free and
 * unit-tested; the network probe lives in factory-client.ts.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { getEnv, upsertEnv } from './env-file'
import { readEnvLines, updateEnvFile } from './factory-dir'

export type DashboardProbeState = 'spa' | 'bare_api' | 'unknown'

/** The bare Hono default response at `/` when no SPA middleware is mounted. */
const BARE_API_MARKER = 'welcome to the mastra api'

/**
 * Classify the body of GET <base>/ — is the dashboard SPA actually mounted?
 * Any HTML counts as `spa` (a served dashboard whose title changed must not
 * trigger the fix banner); non-HTML without the bare-API marker is `unknown`
 * so custom setups are never nagged.
 */
export function classifyDashboardResponse(args: {
  contentType: string
  body: string
}): DashboardProbeState {
  const body = args.body.toLowerCase()
  if (body.includes(BARE_API_MARKER)) return 'bare_api'
  const trimmed = body.trimStart()
  const isHtml =
    args.contentType.toLowerCase().includes('text/html') ||
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html')
  return isHtml ? 'spa' : 'unknown'
}

/** Where the prebuilt dashboard ships inside the checkout's mastra CLI. */
export const BUNDLED_UI_SUBPATH = path.join('node_modules', 'mastra', 'dist', 'factory')
/** Where `mastra build` copies the dashboard (a server-side fallback path). */
export const BUILT_UI_SUBPATH = path.join('src', 'mastra', 'public', 'factory')

export interface UiDistStatus {
  /** Uncommented MASTRACODE_UI_DIST value in .env (last-wins), or null. */
  envValue: string | null
  /** envValue is set and points at an existing index.html. */
  envValid: boolean
  /** Absolute bundled-SPA dir when its index.html exists, else null. */
  bundledDir: string | null
  /** Absolute `mastra build` output dir when its index.html exists, else null. */
  builtDir: string | null
  /** A one-click fix is possible: env not valid and the bundled SPA exists. */
  fixAvailable: boolean
  /** Some candidate the server will find on next boot exists (env or built). */
  servable: boolean
}

/** Pure derivation from pre-checked filesystem facts. */
export function deriveUiDistStatus(args: {
  dir: string
  envValue: string | null
  envIndexExists: boolean
  bundledIndexExists: boolean
  builtIndexExists: boolean
}): UiDistStatus {
  const envValue = args.envValue?.trim() ? args.envValue.trim() : null
  const envValid = envValue !== null && args.envIndexExists
  return {
    envValue,
    envValid,
    bundledDir: args.bundledIndexExists ? path.join(args.dir, BUNDLED_UI_SUBPATH) : null,
    builtDir: args.builtIndexExists ? path.join(args.dir, BUILT_UI_SUBPATH) : null,
    fixAvailable: !envValid && args.bundledIndexExists,
    servable: envValid || args.builtIndexExists
  }
}

async function indexExists(dir: string | null): Promise<boolean> {
  if (!dir) return false
  return fs
    .access(path.join(dir, 'index.html'))
    .then(() => true)
    .catch(() => false)
}

/**
 * Copy the CLI-bundled dashboard into the checkout's src/mastra/public/factory
 * so the server's zero-config fallback (resolve(cwd, 'factory') with
 * cwd = src/mastra/public) finds it with no env dependence, and `mastra build`
 * stages it into production output. Idempotent overwrite; `copied: false`
 * (no throw) when the bundle is missing — the .env fix path already surfaces
 * that as a targeted error.
 */
export async function installBuiltUi(dir: string): Promise<{ copied: boolean }> {
  const src = path.join(dir, BUNDLED_UI_SUBPATH)
  if (!(await indexExists(src))) return { copied: false }
  const dest = path.join(dir, BUILT_UI_SUBPATH)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.cp(src, dest, { recursive: true, force: true })
  return { copied: true }
}

/**
 * Server-start preflight: make the dashboard servable before the boot that
 * reads .env. Best-effort copies the bundled SPA into the zero-config
 * fallback path and, when MASTRACODE_UI_DIST is absent/broken and the bundle
 * exists, points it at the bundle. Never throws — a failed preflight must
 * not block a start (the bare-API banner still offers the explicit fix).
 */
export async function ensureUiDist(
  dir: string
): Promise<{ written: boolean; builtUiInstalled: boolean }> {
  let builtUiInstalled = false
  let written = false
  try {
    builtUiInstalled = (await installBuiltUi(dir)).copied
  } catch {}
  try {
    const status = await inspectUiDist(dir)
    if (!status.envValid && status.bundledDir) {
      const value = status.bundledDir
      await updateEnvFile(dir, (lines) => upsertEnv(lines, { MASTRACODE_UI_DIST: value }))
      written = true
    }
  } catch {}
  return { written, builtUiInstalled }
}

/** Read .env + stat the UI-dist candidates for one checkout. Never throws. */
export async function inspectUiDist(dir: string): Promise<UiDistStatus> {
  const { lines } = await readEnvLines(dir)
  const rawEnv = getEnv(lines, 'MASTRACODE_UI_DIST')?.trim() || null
  const [envIndexExists, bundledIndexExists, builtIndexExists] = await Promise.all([
    indexExists(rawEnv ? path.resolve(dir, rawEnv) : null),
    indexExists(path.join(dir, BUNDLED_UI_SUBPATH)),
    indexExists(path.join(dir, BUILT_UI_SUBPATH))
  ])
  return deriveUiDistStatus({
    dir,
    envValue: rawEnv,
    envIndexExists,
    bundledIndexExists,
    builtIndexExists
  })
}
