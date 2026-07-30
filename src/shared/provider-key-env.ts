/**
 * Pure resolution of provider API keys referenced by environment variable
 * (Settings → API Keys → Environment variables). Users can point a provider at
 * any env var name; Yardarm also auto-detects the standard vars (e.g.
 * ANTHROPIC_API_KEY) from the login shell. This module computes the exact
 * name→value map to inject into agent-host processes — only named key vars are
 * ever forwarded, never the whole login environment. Key values themselves are
 * never persisted; only mappings (provider → env var name) are stored.
 */

/** A user-entered env-var reference for one provider. */
export interface ProviderKeyEnvMapping {
  /** The env var the user keeps their key in (any valid name). */
  envVar: string
  /**
   * The provider's standard var from the SDK catalog's apiKeyEnvVar (resolved
   * at save time) — the name the SDK actually reads, so the mapped value is
   * forwarded under this name.
   */
  standardVar: string
}

/** provider id → mapping, as persisted in app_settings.providerKeyEnvVars. */
export type ProviderKeyEnvMappings = Record<string, ProviderKeyEnvMapping>

/** Valid POSIX-ish env var name (shared by the zod input and the UI gate). */
export const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Standard key vars for cold start / offline, before the live catalog has been
 * seen (the cached catalog names in app_settings self-correct this at runtime).
 * Names verified against the SDK's PROVIDER_REGISTRY (@mastra/core llm) —
 * arrays there resolve to their first entry, hence google → GOOGLE_API_KEY.
 * deepgram is STT-only (absent from the registry); its name matches the CLI's
 * STT map. Re-verify on runtime bumps (see AGENTS.md).
 */
export const SEED_PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  zhipuai: 'ZHIPU_API_KEY',
  togetherai: 'TOGETHER_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  huggingface: 'HF_TOKEN',
  deepgram: 'DEEPGRAM_API_KEY'
}

/** The provider's standard key var: seed entry, else UPPER_SNAKE + _API_KEY. */
export function standardVarFallback(provider: string): string {
  return (
    SEED_PROVIDER_ENV_VARS[provider] ??
    `${provider.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`
  )
}

/**
 * Compute the env vars to inject into agent hosts. Pass 1 auto-detects: every
 * known standard var (live-catalog cache ∪ seed) present in `lookup` is
 * forwarded under its own name. Pass 2 applies explicit mappings: a resolved
 * mapping overwrites the provider's standard var; an unresolved one is skipped
 * (any auto-detected value stays). Rows without a standard var (OAuth-only
 * providers report apiKeyEnvVar: "") are skipped entirely.
 */
export function resolveProviderKeyEnv(
  mappings: ProviderKeyEnvMappings,
  knownStandardVars: string[],
  lookup: (name: string) => string | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  const standardVars = new Set([...knownStandardVars, ...Object.values(SEED_PROVIDER_ENV_VARS)])
  for (const name of standardVars) {
    if (!ENV_VAR_NAME_RE.test(name)) continue
    const value = lookup(name)?.trim()
    if (value) out[name] = value
  }
  for (const mapping of Object.values(mappings)) {
    const { envVar, standardVar } = mapping
    if (!standardVar || !ENV_VAR_NAME_RE.test(standardVar) || !ENV_VAR_NAME_RE.test(envVar)) {
      continue
    }
    const value = lookup(envVar)?.trim()
    if (value) out[standardVar] = value
  }
  return out
}
