import { describe, expect, it } from 'vitest'
import {
  STT_PROVIDER_ENV_VARS,
  buildSttRequest,
  envVarFor,
  httpErrorMessage,
  missingKeyMessage,
  parseDeepgramTranscription,
  parseOpenAiTranscription,
  resolveSttApiKey
} from './stt-transcribe'

describe('STT_PROVIDER_ENV_VARS', () => {
  it('matches the mastracode CLI map exactly (guards drift on re-vendoring)', () => {
    expect(STT_PROVIDER_ENV_VARS).toEqual({
      openai: 'OPENAI_API_KEY',
      groq: 'GROQ_API_KEY',
      alibaba: 'DASHSCOPE_API_KEY',
      'alibaba-cn': 'DASHSCOPE_API_KEY',
      scaleway: 'SCALEWAY_API_KEY',
      nvidia: 'NVIDIA_API_KEY',
      nearai: 'NEAR_AI_API_KEY',
      evroc: 'EVROC_API_KEY',
      deepgram: 'DEEPGRAM_API_KEY'
    })
  })
})

describe('envVarFor', () => {
  it('uses the CLI map for known providers', () => {
    expect(envVarFor('alibaba-cn')).toBe('DASHSCOPE_API_KEY')
  })

  it('falls back to <PROVIDER>_API_KEY for unknown providers', () => {
    expect(envVarFor('someprovider')).toBe('SOMEPROVIDER_API_KEY')
  })
})

describe('resolveSttApiKey', () => {
  const stored = (key: string | undefined) => (): string | undefined => key

  it('prefers the env var over a stored key', () => {
    expect(resolveSttApiKey('openai', { OPENAI_API_KEY: ' env-key ' }, stored('stored-key'))).toBe(
      'env-key'
    )
  })

  it('falls through to the stored key when the env var is whitespace-only', () => {
    expect(resolveSttApiKey('groq', { GROQ_API_KEY: '   ' }, stored('stored-key'))).toBe(
      'stored-key'
    )
  })

  it('uses only the stored key for providers without an env mapping', () => {
    expect(resolveSttApiKey('mystery', { MYSTERY_API_KEY: 'env-key' }, stored('stored-key'))).toBe(
      'stored-key'
    )
  })

  it('returns undefined when neither source has a key', () => {
    expect(resolveSttApiKey('deepgram', {}, stored(undefined))).toBeUndefined()
  })
})

describe('missingKeyMessage', () => {
  it('names the provider, env var, and the API Keys tab', () => {
    const msg = missingKeyMessage('groq')
    expect(msg).toContain('groq')
    expect(msg).toContain('GROQ_API_KEY')
    expect(msg).toContain('API Keys')
  })

  it('derives an env var name for unknown providers', () => {
    expect(missingKeyMessage('acme')).toContain('ACME_API_KEY')
  })
})

describe('buildSttRequest', () => {
  it('uses the OpenAI default base URL for the openai resolver', () => {
    const spec = buildSttRequest({ resolver: 'openai', model: 'whisper-1' }, 'audio/webm', 'k')
    expect(spec.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(spec.headers).toEqual({ Authorization: 'Bearer k' })
    expect(spec.bodyKind).toBe('multipart')
  })

  it('passes through the registry baseURL for openai-compatible hosts', () => {
    const spec = buildSttRequest(
      {
        resolver: 'openai-compatible',
        model: 'whisper-large-v3-turbo',
        baseURL: 'https://api.groq.com/openai/v1'
      },
      'audio/webm;codecs=opus',
      'k'
    )
    expect(spec.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(spec.bodyKind).toBe('multipart')
  })

  it('builds a raw-body Deepgram request with Token auth and a codecs-stripped type', () => {
    const spec = buildSttRequest(
      { resolver: 'deepgram', model: 'nova-3' },
      'audio/webm;codecs=opus',
      'dg-key'
    )
    expect(spec.url).toBe('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true')
    expect(spec.headers).toEqual({
      Authorization: 'Token dg-key',
      'Content-Type': 'audio/webm'
    })
    expect(spec.bodyKind).toBe('raw')
  })
})

describe('transcription response parsers', () => {
  it('extracts and trims the OpenAI text field', () => {
    expect(parseOpenAiTranscription({ text: '  hello world ' })).toBe('hello world')
  })

  it('returns empty for malformed OpenAI responses', () => {
    expect(parseOpenAiTranscription(null)).toBe('')
    expect(parseOpenAiTranscription('nope')).toBe('')
    expect(parseOpenAiTranscription({ text: 42 })).toBe('')
  })

  it('extracts the first Deepgram alternative transcript', () => {
    expect(
      parseDeepgramTranscription({
        results: { channels: [{ alternatives: [{ transcript: ' hi there ' }] }] }
      })
    ).toBe('hi there')
  })

  it('returns empty for malformed Deepgram responses', () => {
    expect(parseDeepgramTranscription(null)).toBe('')
    expect(parseDeepgramTranscription({})).toBe('')
    expect(parseDeepgramTranscription({ results: { channels: [] } })).toBe('')
  })
})

describe('httpErrorMessage', () => {
  it('includes provider and status', () => {
    expect(httpErrorMessage('openai', 401, 'unauthorized')).toBe(
      'openai transcription failed (HTTP 401): unauthorized'
    )
  })

  it('collapses whitespace and trims long bodies to ~300 chars', () => {
    const msg = httpErrorMessage('groq', 500, `a\n${'b'.repeat(500)}`)
    expect(msg.length).toBeLessThanOrEqual('groq transcription failed (HTTP 500): '.length + 300)
    expect(msg).toContain('a b')
  })

  it('omits the colon when the body is empty', () => {
    expect(httpErrorMessage('deepgram', 503, '  ')).toBe('deepgram transcription failed (HTTP 503)')
  })
})
