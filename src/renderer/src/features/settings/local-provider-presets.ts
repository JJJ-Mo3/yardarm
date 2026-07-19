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

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    tag: 'qwen2.5-coder:32b',
    label: 'Qwen 2.5 Coder 32B',
    note: 'Best local coding model — recommended for agent use',
    sizeLabel: '~20 GB'
  },
  {
    tag: 'qwen2.5-coder:7b',
    label: 'Qwen 2.5 Coder 7B',
    note: 'Lighter coder for machines with less RAM',
    sizeLabel: '~4.7 GB'
  },
  {
    tag: 'llama3.3:70b',
    label: 'Llama 3.3 70B',
    note: 'Strong general model — needs a big machine',
    sizeLabel: '~43 GB'
  },
  {
    tag: 'llama3.2:3b',
    label: 'Llama 3.2 3B',
    note: 'Small and fast — limited tool-calling ability',
    sizeLabel: '~2 GB'
  }
]
