/**
 * Marks catalog models served by settings.json customProviders (local Ollama /
 * LM Studio etc.) as usable. The SDK reports hasApiKey=false for keyless
 * custom providers even though it runs them keyless at runtime.
 * `customProviderSlug` mirrors @mastra/code-sdk's getCustomProviderId
 * (dist/onboarding/settings.js) and the 'mastracode/<slug>' registry key from
 * getGatewayProviderKey (dist/agents/mastracode-gateway.js).
 */
import type { ModelInfo } from '../../../shared/ipc-types'

export function customProviderSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'provider'
}

export function markCustomProviderModels(
  models: ModelInfo[],
  providers: Array<{ name: string }>
): ModelInfo[] {
  const keys = new Set<string>()
  for (const p of providers) {
    const slug = customProviderSlug(p.name)
    // Mirror getGatewayProviderKey: the bare key only when slug === gateway id.
    keys.add(slug === 'mastracode' ? 'mastracode' : `mastracode/${slug}`)
  }
  if (keys.size === 0) return models
  return models.map((m) => (keys.has(m.provider) && !m.hasApiKey ? { ...m, hasApiKey: true } : m))
}
