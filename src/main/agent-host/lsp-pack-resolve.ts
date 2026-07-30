/**
 * Resolve entry files inside downloaded optional language-server packs.
 *
 * Packs live at <lspServersDir>/<packId>/<version>/ with the npm package
 * tree under node_modules/ and a pack.json manifest written by the pack
 * manager after a completed (atomic-renamed) install. The catalog's pinned
 * version is preferred; any other complete install is a fallback so a newer
 * app can still use a previously downloaded pack until it is updated.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** Descending "newest first" order for dotted numeric version dir names. */
function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (Number.isNaN(da) || Number.isNaN(db)) return a < b ? 1 : -1
    if (da !== db) return db - da
  }
  return 0
}

/**
 * Absolute path of `<pkg>/<sub>` inside an installed pack, or undefined when
 * no complete install exists. Prefers `preferredVersion` (the catalog pin),
 * else the newest installed version whose pack.json and entry file exist.
 */
export function resolvePackEntry(
  lspServersDir: string,
  packId: string,
  pkg: string,
  sub: string,
  preferredVersion: string
): string | undefined {
  const packDir = path.join(lspServersDir, packId)
  const entryFor = (version: string): string | undefined => {
    const versionDir = path.join(packDir, version)
    const entry = path.join(versionDir, 'node_modules', pkg, sub)
    if (existsSync(path.join(versionDir, 'pack.json')) && existsSync(entry)) return entry
    return undefined
  }
  const preferred = entryFor(preferredVersion)
  if (preferred) return preferred
  let versions: string[]
  try {
    versions = readdirSync(packDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.includes('.tmp-'))
      .map((d) => d.name)
  } catch {
    return undefined
  }
  for (const version of versions.sort(compareVersionsDesc)) {
    const entry = entryFor(version)
    if (entry) return entry
  }
  return undefined
}
