/**
 * Presets for the "Add local model" wizard: common local OpenAI-compatible
 * servers plus curated model recommendations. All setup still lands in
 * mastracode's settings.json `customProviders`.
 */

export interface LocalProviderPreset {
  id: 'ollama' | 'lmstudio' | 'llamacpp' | 'vllm' | 'custom'
  title: string
  subtitle: string
  defaultUrl: string
  defaultName: string
  apiKey: 'none' | 'optional'
  /** Shown when the server can't be reached. */
  downHint: string
  /** Shown when the server is up but has no models. */
  emptyHint?: string
  /** Always-visible note about raising the server's context window for agent use. */
  contextHint?: string
  downloadUrl?: string
}

export const LOCAL_PROVIDER_PRESETS: LocalProviderPreset[] = [
  {
    id: 'ollama',
    title: 'Ollama',
    subtitle: 'Easiest way to run models locally — free, no account',
    defaultUrl: 'http://localhost:11434/v1',
    defaultName: 'ollama',
    apiKey: 'none',
    downHint: 'Is Ollama running? Start it with `ollama serve` or open the Ollama app.',
    emptyHint: 'No models installed yet — download one below to get started.',
    contextHint:
      "Agent use needs a big context window — the agent's base prompt alone is ~30k tokens. Set 64k minimum (128k+ if you have the RAM) in the Ollama app (Settings → Context length) or start with OLLAMA_CONTEXT_LENGTH=65536.",
    downloadUrl: 'https://ollama.com/download'
  },
  {
    id: 'lmstudio',
    title: 'LM Studio',
    subtitle: 'Desktop app with a built-in model browser',
    defaultUrl: 'http://localhost:1234/v1',
    defaultName: 'lm-studio',
    apiKey: 'none',
    downHint: 'In LM Studio, enable the local server (Developer tab → Start Server).',
    emptyHint: 'No models loaded — download one in LM Studio (Discover tab) and load it.',
    contextHint:
      "Agent use needs a big context window — the agent's base prompt alone is ~30k tokens. Set the context length to 64k minimum (128k+ if you have the RAM) when loading the model in LM Studio.",
    downloadUrl: 'https://lmstudio.ai'
  },
  {
    id: 'llamacpp',
    title: 'llama.cpp server',
    subtitle: 'Lightweight server for GGUF models',
    defaultUrl: 'http://localhost:8080/v1',
    defaultName: 'llama-cpp',
    apiKey: 'none',
    downHint: 'Start it with `llama-server -m model.gguf`.',
    contextHint:
      "Agent use needs a big context window — the agent's base prompt alone is ~30k tokens. Start the server with `-c 65536` or higher.",
    downloadUrl: 'https://github.com/ggml-org/llama.cpp'
  },
  {
    id: 'vllm',
    title: 'vLLM',
    subtitle: 'High-throughput server for Hugging Face models',
    defaultUrl: 'http://localhost:8000/v1',
    defaultName: 'vllm',
    apiKey: 'optional',
    downHint: 'Start with `vllm serve <model>`; add the key here if you passed --api-key.',
    downloadUrl: 'https://docs.vllm.ai'
  },
  {
    id: 'custom',
    title: 'Custom / other',
    subtitle: 'Any other OpenAI-compatible server',
    defaultUrl: '',
    defaultName: 'my-llm',
    apiKey: 'optional',
    downHint: 'Check the URL and make sure the server is running.'
  }
]

export interface RecommendedModel {
  /** Ollama tag; doubles as the model id served via /v1/models. */
  tag: string
  label: string
  note: string
  sizeLabel: string
}

// Tags and sizes verified against ollama.com/library (July 2026).
export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    tag: 'qwen3.6:27b',
    label: 'Qwen3.6 27B',
    note: 'Best local coding model (256K context) — recommended for agent use',
    sizeLabel: '~17 GB'
  },
  {
    tag: 'qwen3.6:35b',
    label: 'Qwen3.6 35B',
    note: 'MoE with 3B active — faster responses at similar quality',
    sizeLabel: '~24 GB'
  },
  {
    tag: 'devstral-small-2:24b',
    label: 'Devstral Small 2 24B',
    note: 'Built for coding agents — multi-file edits, 384K context',
    sizeLabel: '~15 GB'
  },
  {
    tag: 'gpt-oss:20b',
    label: 'GPT-OSS 20B',
    note: "OpenAI's open-weight reasoning model — fits 16 GB machines",
    sizeLabel: '~14 GB'
  },
  {
    tag: 'qwen3:8b',
    label: 'Qwen 3 8B',
    note: 'Small and fast, with tool calling — for machines with less RAM',
    sizeLabel: '~5.2 GB'
  },
  {
    tag: 'gpt-oss:120b',
    label: 'GPT-OSS 120B',
    note: 'Strong general model — needs a big machine',
    sizeLabel: '~65 GB'
  }
]
