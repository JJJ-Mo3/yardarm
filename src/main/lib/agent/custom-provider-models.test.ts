/** Tests for the custom-provider model usability override. */
import { describe, expect, it } from 'vitest'
import { customProviderSlug, markCustomProviderModels } from './custom-provider-models'
import type { ModelInfo } from '../../../shared/ipc-types'

function model(provider: string, modelName: string, hasApiKey: boolean): ModelInfo {
  return { id: `${provider}/${modelName}`, provider, modelName, hasApiKey }
}

describe('customProviderSlug', () => {
  it('slugifies like the SDK getCustomProviderId', () => {
    expect(customProviderSlug('Ollama')).toBe('ollama')
    expect(customProviderSlug('My LM Studio!')).toBe('my-lm-studio')
    expect(customProviderSlug('  --  ')).toBe('provider')
    expect(customProviderSlug('Mastracode')).toBe('mastracode')
  })
})

describe('markCustomProviderModels', () => {
  it('flips hasApiKey for models under mastracode/<slug>', () => {
    const models = [model('mastracode/ollama', 'qwen3.6:8b', false), model('anthropic', 'x', true)]
    const out = markCustomProviderModels(models, [{ name: 'Ollama' }])
    expect(out[0].hasApiKey).toBe(true)
    expect(out[1].hasApiKey).toBe(true)
  })

  it('never matches built-in providers by bare slug', () => {
    const models = [model('anthropic', 'claude-x', false)]
    const out = markCustomProviderModels(models, [{ name: 'Anthropic' }])
    expect(out[0].hasApiKey).toBe(false)
  })

  it('matches the bare mastracode key only for a provider named mastracode', () => {
    const models = [model('mastracode', 'foo', false)]
    expect(markCustomProviderModels(models, [{ name: 'Mastracode' }])[0].hasApiKey).toBe(true)
    expect(markCustomProviderModels(models, [{ name: 'Ollama' }])[0].hasApiKey).toBe(false)
  })

  it('leaves already-usable models unchanged', () => {
    const models = [model('mastracode/ollama', 'qwen3.6:8b', true)]
    const out = markCustomProviderModels(models, [{ name: 'Ollama' }])
    expect(out[0]).toBe(models[0])
  })

  it('returns the same array when there are no custom providers', () => {
    const models = [model('mastracode/ollama', 'qwen3.6:8b', false)]
    expect(markCustomProviderModels(models, [])).toBe(models)
  })
})
