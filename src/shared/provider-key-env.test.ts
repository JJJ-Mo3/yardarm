/**
 * resolveProviderKeyEnv forwards only named provider-key env vars: standard
 * vars are auto-detected, explicit mappings overwrite them, and nothing else
 * from the environment ever leaks through.
 */
import { describe, expect, it } from 'vitest'
import {
  ENV_VAR_NAME_RE,
  resolveProviderKeyEnv,
  standardVarFallback,
  type ProviderKeyEnvMappings
} from './provider-key-env'

const lookupFrom =
  (env: Record<string, string>) =>
  (name: string): string | undefined =>
    env[name]

describe('resolveProviderKeyEnv', () => {
  it('auto-detects known standard vars present in the lookup', () => {
    const out = resolveProviderKeyEnv({}, [], lookupFrom({ ANTHROPIC_API_KEY: 'sk-ant' }))
    expect(out).toEqual({ ANTHROPIC_API_KEY: 'sk-ant' })
  })

  it('auto-detects vars from the live-catalog cache too', () => {
    const out = resolveProviderKeyEnv(
      {},
      ['CUSTOM_CATALOG_KEY'],
      lookupFrom({ CUSTOM_CATALOG_KEY: 'k' })
    )
    expect(out.CUSTOM_CATALOG_KEY).toBe('k')
  })

  it('explicit mapping overwrites an auto-detected standard var', () => {
    const mappings: ProviderKeyEnvMappings = {
      anthropic: { envVar: 'MY_WORK_KEY', standardVar: 'ANTHROPIC_API_KEY' }
    }
    const out = resolveProviderKeyEnv(
      mappings,
      [],
      lookupFrom({ ANTHROPIC_API_KEY: 'from-shell', MY_WORK_KEY: 'from-mapping' })
    )
    expect(out.ANTHROPIC_API_KEY).toBe('from-mapping')
  })

  it('an unresolved mapping keeps the auto-detected standard var', () => {
    const mappings: ProviderKeyEnvMappings = {
      anthropic: { envVar: 'MISSING_VAR', standardVar: 'ANTHROPIC_API_KEY' }
    }
    const out = resolveProviderKeyEnv(mappings, [], lookupFrom({ ANTHROPIC_API_KEY: 'from-shell' }))
    expect(out.ANTHROPIC_API_KEY).toBe('from-shell')
  })

  it('never forwards vars that are not standard vars or mapped', () => {
    const out = resolveProviderKeyEnv(
      {},
      [],
      lookupFrom({ RANDOM_SECRET: 'x', AWS_SESSION_TOKEN: 'y' })
    )
    expect(out).toEqual({})
  })

  it('skips mappings with an empty standard var (OAuth-only providers)', () => {
    const mappings: ProviderKeyEnvMappings = {
      'github-copilot': { envVar: 'SOME_VAR', standardVar: '' }
    }
    const out = resolveProviderKeyEnv(mappings, [], lookupFrom({ SOME_VAR: 'x' }))
    expect(out).toEqual({})
  })

  it('ignores whitespace-only values and invalid var names', () => {
    const out = resolveProviderKeyEnv(
      { openai: { envVar: 'not a name', standardVar: 'OPENAI_API_KEY' } },
      ['BAD NAME'],
      lookupFrom({ ANTHROPIC_API_KEY: '   ', 'BAD NAME': 'x', 'not a name': 'y' })
    )
    expect(out).toEqual({})
  })
})

describe('standardVarFallback', () => {
  it('uses the seed table when present', () => {
    expect(standardVarFallback('google')).toBe('GOOGLE_API_KEY')
    expect(standardVarFallback('huggingface')).toBe('HF_TOKEN')
  })

  it('falls back to UPPER_SNAKE + _API_KEY, sanitizing hyphens', () => {
    expect(standardVarFallback('foobar')).toBe('FOOBAR_API_KEY')
    expect(standardVarFallback('some-provider')).toBe('SOME_PROVIDER_API_KEY')
    expect(ENV_VAR_NAME_RE.test(standardVarFallback('some-provider'))).toBe(true)
  })
})
