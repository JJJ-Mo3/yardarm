/**
 * Pure parsing helper for npm registry `<package>/latest` responses. Kept
 * free of Electron imports so it stays unit-testable; the network fetch
 * lives in mastracode-info.ts.
 */

/** Extracts the version string from a registry `/latest` JSON body, or null. */
export function parseNpmLatest(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const version = (json as { version?: unknown }).version
  return typeof version === 'string' && version.length > 0 ? version : null
}
