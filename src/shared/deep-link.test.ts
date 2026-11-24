import { describe, expect, it } from 'vitest'
import {
  DEEP_LINK_MAX_PROJECT_LENGTH,
  DEEP_LINK_MAX_PROMPT_LENGTH,
  DEEP_LINK_MAX_URL_LENGTH,
  findProjectByName,
  isDeepLinkUrl,
  parseDeepLink
} from './deep-link'

function ok(url: string): { project: string | null; prompt: string | null } {
  const res = parseDeepLink(url)
  if (!res.ok) throw new Error(`expected ok, got: ${res.error}`)
  return { project: res.request.project, prompt: res.request.prompt }
}

function rejected(url: unknown): boolean {
  return !parseDeepLink(url).ok
}

describe('parseDeepLink', () => {
  it('parses the new action with both parameters', () => {
    expect(ok('yardarm://new?project=My%20App&prompt=Fix%20the%20login%20bug')).toEqual({
      project: 'My App',
      prompt: 'Fix the login bug'
    })
  })

  it('accepts form-encoded spaces, a trailing slash, and a mixed-case scheme/action', () => {
    expect(ok('yardarm://new/?project=My+App&prompt=a+b')).toEqual({
      project: 'My App',
      prompt: 'a b'
    })
    expect(ok('YARDARM://NEW?project=x').project).toBe('x')
  })

  it('treats missing or blank parameters as absent', () => {
    expect(ok('yardarm://new')).toEqual({ project: null, prompt: null })
    expect(ok('yardarm://new?project=%20%20&prompt=')).toEqual({ project: null, prompt: null })
  })

  it('ignores unknown parameters and the fragment', () => {
    expect(ok('yardarm://new?project=a&send=1&mode=yolo&model=x#frag')).toEqual({
      project: 'a',
      prompt: null
    })
  })

  it('rejects other actions, paths, schemes and malformed input', () => {
    expect(rejected('yardarm://run?cmd=ls')).toBe(true)
    expect(rejected('yardarm://settings?x=1')).toBe(true)
    expect(rejected('yardarm://new/extra?project=a')).toBe(true)
    expect(rejected('yardarm://newer?project=a')).toBe(true)
    expect(rejected('yardarm://?project=a')).toBe(true)
    expect(rejected('yardarm:new?project=a')).toBe(true)
    expect(rejected('https://new?project=a')).toBe(true)
    expect(rejected('file:///etc/passwd')).toBe(true)
    expect(rejected('yardarm://user:pw@new?project=a')).toBe(true)
    expect(rejected('yardarm://new:8080?project=a')).toBe(true)
    expect(rejected('')).toBe(true)
    expect(rejected(undefined)).toBe(true)
    expect(rejected(42)).toBe(true)
    expect(rejected('--inspect=0')).toBe(true)
  })

  it('rejects repeated known parameters', () => {
    expect(rejected('yardarm://new?project=a&project=b')).toBe(true)
    expect(rejected('yardarm://new?prompt=a&prompt=b')).toBe(true)
  })

  it('rejects over-long values instead of truncating', () => {
    const atCap = 'p'.repeat(DEEP_LINK_MAX_PROJECT_LENGTH)
    expect(ok(`yardarm://new?project=${atCap}`).project).toBe(atCap)
    expect(rejected(`yardarm://new?project=${atCap}x`)).toBe(true)

    const promptAtCap = 'q'.repeat(DEEP_LINK_MAX_PROMPT_LENGTH)
    expect(ok(`yardarm://new?prompt=${promptAtCap}`).prompt).toBe(promptAtCap)
    expect(rejected(`yardarm://new?prompt=${promptAtCap}x`)).toBe(true)

    expect(rejected(`yardarm://new?junk=${'j'.repeat(DEEP_LINK_MAX_URL_LENGTH)}`)).toBe(true)
  })

  it('strips control characters, keeping newlines and tabs only in the prompt', () => {
    const res = ok(
      'yardarm://new?project=My%00%1B%5B31m%0AApp%7F&prompt=line1%0D%0Aline2%09x%00%1B%07'
    )
    expect(res.project).toBe('My[31mApp')
    expect(res.prompt).toBe('line1\nline2\tx')
  })

  it('strips bidi overrides and (in the project) zero-width characters', () => {
    const res = ok(
      `yardarm://new?project=${encodeURIComponent('a‮b​c﻿')}&prompt=${encodeURIComponent('x‮y⁦z')}`
    )
    expect(res.project).toBe('abc')
    expect(res.prompt).toBe('xyz')
  })

  it('never yields anything but the new action', () => {
    const res = parseDeepLink('yardarm://new?action=send&project=a')
    expect(res.ok && res.request.action).toBe('new')
    expect(res.ok && Object.keys(res.request).sort()).toEqual(['action', 'project', 'prompt'])
  })
})

describe('isDeepLinkUrl', () => {
  it('matches only yardarm:// strings', () => {
    expect(isDeepLinkUrl('yardarm://new')).toBe(true)
    expect(isDeepLinkUrl('Yardarm://new')).toBe(true)
    expect(isDeepLinkUrl('yardarm:new')).toBe(false)
    expect(isDeepLinkUrl('--yardarm://new')).toBe(false)
    expect(isDeepLinkUrl(null)).toBe(false)
  })
})

describe('findProjectByName', () => {
  const projects = [{ name: 'Alpha' }, { name: 'alpha' }, { name: 'Beta App' }]

  it('matches case-insensitively, preferring the same-case name', () => {
    expect(findProjectByName(projects, 'alpha')).toBe(projects[1])
    expect(findProjectByName(projects, 'ALPHA')).toBe(projects[0])
    expect(findProjectByName(projects, 'beta app')).toBe(projects[2])
  })

  it('returns null for unknown or partial names', () => {
    expect(findProjectByName(projects, 'Beta')).toBeNull()
    expect(findProjectByName(projects, 'gamma')).toBeNull()
    expect(findProjectByName([], 'x')).toBeNull()
  })
})
