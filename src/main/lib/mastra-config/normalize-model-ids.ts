/**
 * One-shot startup migration for mastracode settings.json: rewrites
 * gateway-prefixed custom-provider model ids ('mastracode/<slug>/<model>')
 * saved by earlier app versions into the '<slug>/<model>' form the SDK's
 * runtime resolver expects (see src/main/lib/agent/custom-provider-models.ts).
 * Walks the models section and custom model packs; all other keys — and any
 * id that doesn't match a configured custom provider — are left untouched.
 */
import { normalizeCustomProviderModelId } from '../agent/custom-provider-models'
import { readSettings, updateSettings } from './settings-json'

/** Rewrites every string value under `obj` via `fix`; returns whether anything changed. */
function fixStringsInPlace(obj: unknown, fix: (value: string) => string): boolean {
  if (!obj || typeof obj !== 'object') return false
  let changed = false
  const record = obj as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      const next = fix(value)
      if (next !== value) {
        record[key] = next
        changed = true
      }
    } else if (value && typeof value === 'object') {
      // Arrays recurse element-wise via Object.entries as well.
      if (fixStringsInPlace(value, fix)) changed = true
    }
  }
  return changed
}

export async function normalizeModelIdsInSettings(): Promise<void> {
  const current = await readSettings()
  const providers = current.customProviders ?? []
  if (providers.length === 0) return
  const fix = (id: string): string => normalizeCustomProviderModelId(id, providers)
  // Probe on the freshly-read copy so untouched files are never rewritten.
  const probe = structuredClone({ models: current.models, packs: current.customModelPacks })
  if (!fixStringsInPlace(probe, fix)) return
  await updateSettings((s) => {
    const liveFix = (id: string): string =>
      normalizeCustomProviderModelId(id, s.customProviders ?? [])
    fixStringsInPlace(s.models, liveFix)
    fixStringsInPlace(s.customModelPacks, liveFix)
  })
}
