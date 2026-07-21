/**
 * Minimal semver helpers for the in-app updater. Only what release-tag
 * comparison needs: parse `v?major.minor.patch[-prerelease]` and decide
 * whether a candidate is strictly newer. Fails closed — anything that
 * doesn't parse is never treated as an update.
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

export function parseVersion(input: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null
  }
}

/**
 * True only when `latest` is a strictly newer release than `current`.
 * A prerelease of the same major.minor.patch is NOT newer than the release
 * (or another prerelease) — prerelease ordering isn't worth implementing for
 * an updater that only ever ships plain releases.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = parseVersion(current)
  const b = parseVersion(latest)
  if (!a || !b) return false
  if (b.major !== a.major) return b.major > a.major
  if (b.minor !== a.minor) return b.minor > a.minor
  if (b.patch !== a.patch) return b.patch > a.patch
  // Same triple: only "current is a prerelease, latest is the release" is an upgrade.
  return a.prerelease !== null && b.prerelease === null
}
