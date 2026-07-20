/** Tests for custom-provider model id normalization and usability override. */
import { describe, expect, it } from 'vitest'
import {
  customProviderSlug,
  normalizeCustomProviderModelId,
  normalizeCustomProviderModels
} from './custom-provider-models'
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

describe('normalizeCustomProviderModelId', () => {
  it('strips the gateway prefix for custom-provider ids', () => {
    expect(
      normalizeCustomProviderModelId('mastracode/ollama/qwen3.6:27b', [{ name: 'Ollama' }])
    ).toBe('ollama/qwen3.6:27b')
  })

  it('works for any provider name via its slug', () => {
    expect(
      normalizeCustomProviderModelId('mastracode/my-lm-studio/foo', [{ name: 'My LM Studio!' }])
    ).toBe('my-lm-studio/foo')
  })

  it('preserves model names containing slashes and colons', () => {
    expect(
      normalizeCustomProviderModelId('mastracode/ollama/hf.co/org/model:tag', [{ name: 'Ollama' }])
    ).toBe('ollama/hf.co/org/model:tag')
  })

  it('always strips github-copilot ids', () => {
    expect(normalizeCustomProviderModelId('mastracode/github-copilot/gpt-x', [])).toBe(
      'github-copilot/gpt-x'
    )
  })

  it('leaves unrelated and unknown ids unchanged', () => {
    expect(normalizeCustomProviderModelId('anthropic/claude-x', [{ name: 'Ollama' }])).toBe(
      'anthropic/claude-x'
    )
    expect(normalizeCustomProviderModelId('mastracode/unknown/model', [{ name: 'Ollama' }])).toBe(
      'mastracode/unknown/model'
    )
    expect(normalizeCustomProviderModelId('mastracode/foo', [{ name: 'Ollama' }])).toBe(
      'mastracode/foo'
    )
  })

  it('does not strip ids of a provider slugged mastracode', () => {
    expect(normalizeCustomProviderModelId('mastracode/a/b', [{ name: 'Mastracode' }])).toBe(
      'mastracode/a/b'
    )
  })
})

describe('normalizeCustomProviderModels', () => {
  it('strips id/provider and flips hasApiKey for keyless custom providers', () => {
    const models = [model('mastracode/ollama', 'qwen3.6:27b', false), model('anthropic', 'x', true)]
    const out = normalizeCustomProviderModels(models, [{ name: 'Ollama' }])
    expect(out[0]).toEqual({
      id: 'ollama/qwen3.6:27b',
      provider: 'ollama',
      modelName: 'qwen3.6:27b',
      hasApiKey: true
    })
    expect(out[1]).toBe(models[1])
  })

  it('normalizes multiple providers independently', () => {
    const models = [
      model('mastracode/ollama', 'a', false),
      model('mastracode/my-lm-studio', 'b', false)
    ]
    const out = normalizeCustomProviderModels(models, [
      { name: 'Ollama' },
      { name: 'My LM Studio!' }
    ])
    expect(out.map((m) => m.id)).toEqual(['ollama/a', 'my-lm-studio/b'])
    expect(out.every((m) => m.hasApiKey)).toBe(true)
  })

  it('strips github-copilot ids but leaves hasApiKey alone', () => {
    const models = [model('mastracode/github-copilot', 'gpt-x', false)]
    const out = normalizeCustomProviderModels(models, [])
    expect(out[0].id).toBe('github-copilot/gpt-x')
    expect(out[0].provider).toBe('github-copilot')
    expect(out[0].hasApiKey).toBe(false)
  })

  it('keeps hasApiKey true when the provider has a key', () => {
    const models = [model('mastracode/ollama', 'a', true)]
    const out = normalizeCustomProviderModels(models, [{ name: 'Ollama' }])
    expect(out[0].id).toBe('ollama/a')
    expect(out[0].hasApiKey).toBe(true)
  })

  it('never matches built-in providers by bare slug', () => {
    const models = [model('anthropic', 'claude-x', false)]
    const out = normalizeCustomProviderModels(models, [{ name: 'Anthropic' }])
    expect(out[0]).toBe(models[0])
  })

  it('leaves the bare mastracode key unstripped, only fixing usability', () => {
    const models = [model('mastracode', 'foo', false)]
    const withProvider = normalizeCustomProviderModels(models, [{ name: 'Mastracode' }])
    expect(withProvider[0]).toEqual({ ...models[0], hasApiKey: true })
    const without = normalizeCustomProviderModels(models, [{ name: 'Ollama' }])
    expect(without[0]).toBe(models[0])
  })

  it('leaves unknown mastracode-prefixed providers unchanged', () => {
    const models = [model('mastracode/unknown', 'foo', false)]
    expect(normalizeCustomProviderModels(models, [{ name: 'Ollama' }])[0]).toBe(models[0])
  })
})
