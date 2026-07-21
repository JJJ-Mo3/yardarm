/**
 * Pure helpers for cloud speech-to-text transcription in the agent host.
 * mastracode's own voice/transcribe module is bundled inside its TUI and not
 * importable, so this replicates the CLI's contract: the provider env-var map,
 * env-then-stored-key resolution, and the HTTP shapes of the STT endpoints
 * listed in @mastra/code-sdk/voice/stt-registry.
 */

/** Replicates mastracode's PROVIDER_ENV_VAR map — the CLI contract. */
export const STT_PROVIDER_ENV_VARS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  alibaba: 'DASHSCOPE_API_KEY',
  'alibaba-cn': 'DASHSCOPE_API_KEY',
  scaleway: 'SCALEWAY_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  nearai: 'NEAR_AI_API_KEY',
  evroc: 'EVROC_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY'
}

function envVarFor(provider: string): string {
  return STT_PROVIDER_ENV_VARS[provider] ?? `${provider.toUpperCase()}_API_KEY`
}

/** Env var (trimmed) wins, then the stored `apikey:<provider>` key — matches the CLI. */
export function resolveSttApiKey(
  provider: string,
  env: Record<string, string | undefined>,
  getStoredApiKey: (provider: string) => string | undefined
): string | undefined {
  const envVar = STT_PROVIDER_ENV_VARS[provider]
  const fromEnv = envVar ? env[envVar]?.trim() : undefined
  if (fromEnv) return fromEnv
  return getStoredApiKey(provider)
}

/** Actionable no-key message naming the provider, env var, and the API Keys tab. */
export function missingKeyMessage(provider: string): string {
  return (
    `Voice transcription needs a ${provider} API key. Add one in Settings → API Keys ` +
    `or set ${envVarFor(provider)}. (OAuth logins don't work for transcription.)`
  )
}

export interface SttRequestSpec {
  url: string
  headers: Record<string, string>
  /** 'multipart' → FormData with file+model fields; 'raw' → the audio bytes. */
  bodyKind: 'multipart' | 'raw'
}

/** Build the HTTP request shape for a registry entry (pure — no fetch, no FormData). */
export function buildSttRequest(
  entry: { resolver: 'openai' | 'openai-compatible' | 'deepgram'; model: string; baseURL?: string },
  mimeType: string,
  apiKey: string
): SttRequestSpec {
  if (entry.resolver === 'deepgram') {
    const params = new URLSearchParams({ model: entry.model, smart_format: 'true' })
    return {
      url: `https://api.deepgram.com/v1/listen?${params.toString()}`,
      headers: {
        Authorization: `Token ${apiKey}`,
        // Deepgram sniffs the container; codecs params confuse it.
        'Content-Type': mimeType.split(';')[0].trim()
      },
      bodyKind: 'raw'
    }
  }
  const base = entry.baseURL ?? 'https://api.openai.com/v1'
  return {
    url: `${base.replace(/\/$/, '')}/audio/transcriptions`,
    // Content-Type is set by FormData (multipart boundary).
    headers: { Authorization: `Bearer ${apiKey}` },
    bodyKind: 'multipart'
  }
}

/** Extract the transcript from an OpenAI-shaped response ({ text }); '' if absent. */
export function parseOpenAiTranscription(json: unknown): string {
  if (json && typeof json === 'object') {
    const text = (json as Record<string, unknown>).text
    if (typeof text === 'string') return text.trim()
  }
  return ''
}

/** Extract results.channels[0].alternatives[0].transcript; '' if absent. */
export function parseDeepgramTranscription(json: unknown): string {
  try {
    const results = (json as { results?: unknown })?.results as {
      channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }>
    }
    const transcript = results?.channels?.[0]?.alternatives?.[0]?.transcript
    if (typeof transcript === 'string') return transcript.trim()
  } catch {}
  return ''
}

/** Trim an HTTP error body into an actionable one-line message. */
export function httpErrorMessage(provider: string, status: number, body: string): string {
  const trimmed = body.replace(/\s+/g, ' ').trim().slice(0, 300)
  return `${provider} transcription failed (HTTP ${status})${trimmed ? `: ${trimmed}` : ''}`
}
