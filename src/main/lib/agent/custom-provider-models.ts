/**
 * Normalizes catalog models served through the mastracode gateway —
 * settings.json customProviders (local Ollama / LM Studio etc.) plus
 * github-copilot. Fixes two SDK inconsistencies:
 *
 * - The catalog emits ids as 'mastracode/<slug>/<model>', but the runtime
 *   resolver (@mastra/code-sdk dist/agents/model.js resolveModel) splits on the
 *   FIRST slash and only strips the 'mastra/' cloud-gateway prefix, so prefixed
 *   ids fail with "Could not find config for provider mastracode". We strip the
 *   gateway segment so ids resolve as '<slug>/<model>'.
 * - Keyless custom providers report hasApiKey=false even though the SDK runs
 *   them keyless at runtime (resolveLanguageModel → createOpenAICompatible).
 *
 * `customProviderSlug` mirrors @mastra/code-sdk's getCustomProviderId
 * (dist/onboarding/settings.js) and the 'mastracode/<slug>' registry key from
 * getGatewayProviderKey (dist/agents/mastracode-gateway.js).
 */
import type { ModelInfo } from '../../../shared/ipc-types'

const GATEWAY_ID = 'mastracode'

export function customProviderSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'provider'
}

/** Provider slugs the mastracode gateway serves whose ids need the prefix stripped. */
function strippableSlugs(providers: Array<{ name: string }>): Set<string> {
  const slugs = new Set<string>(['github-copilot'])
  for (const p of providers) slugs.add(customProviderSlug(p.name))
  // A provider literally slugged 'mastracode' gets the bare 'mastracode' registry
  // key; its 'mastracode/<model>' ids are already resolvable as-is.
  slugs.delete(GATEWAY_ID)
  return slugs
}

/**
 * Strips the leading 'mastracode/' gateway segment from a model id when the
 * next segment is a provider the gateway serves (custom provider slug or
 * github-copilot), yielding the '<slug>/<model>' form the SDK resolver expects.
 * All other ids are returned unchanged.
 */
export function normalizeCustomProviderModelId(
  modelId: string,
  providers: Array<{ name: string }>
): string {
  const parts = modelId.split('/')
  if (parts.length < 3 || parts[0] !== GATEWAY_ID) return modelId
  if (!strippableSlugs(providers).has(parts[1])) return modelId
  return parts.slice(1).join('/')
}

/**
 * Normalizes a model catalog: strips the gateway prefix from id/provider of
 * mastracode-gateway entries and marks keyless custom-provider models usable.
 */
export function normalizeCustomProviderModels(
  models: ModelInfo[],
  providers: Array<{ name: string }>
): ModelInfo[] {
  const customSlugs = new Set(providers.map((p) => customProviderSlug(p.name)))
  const slugs = strippableSlugs(providers)
  return models.map((m) => {
    const [gateway, slug] = m.provider.split('/')
    if (gateway !== GATEWAY_ID) return m
    if (!slug) {
      // Bare 'mastracode' key (provider slugged 'mastracode'): resolvable as-is.
      return customSlugs.has(GATEWAY_ID) && !m.hasApiKey ? { ...m, hasApiKey: true } : m
    }
    if (!slugs.has(slug)) return m
    return {
      ...m,
      id: m.id.startsWith(`${GATEWAY_ID}/`) ? m.id.slice(GATEWAY_ID.length + 1) : m.id,
      provider: slug,
      // The SDK runs keyless custom providers fine; copilot keeps its oauth state.
      hasApiKey: m.hasApiKey || customSlugs.has(slug)
    }
  })
}
