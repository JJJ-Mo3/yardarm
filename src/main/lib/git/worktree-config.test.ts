import { describe, expect, it } from 'vitest'
import {
  applyWorktreeConfig,
  cleanList,
  isWorktreeConfigEmpty,
  parseWorktreeConfig
} from './worktree-config'

describe('parseWorktreeConfig', () => {
  it('reads all three lists', () => {
    expect(
      parseWorktreeConfig({
        'setup-worktree': ['npm install'],
        'copy-files': ['.env.local', 'config/*.local.json'],
        'teardown-worktree': ['docker compose down']
      })
    ).toEqual({
      setup: ['npm install'],
      copyFiles: ['.env.local', 'config/*.local.json'],
      teardown: ['docker compose down']
    })
  })

  it('treats missing, malformed and non-string entries as empty', () => {
    expect(parseWorktreeConfig(null)).toEqual({ setup: [], copyFiles: [], teardown: [] })
    expect(parseWorktreeConfig(['npm install'])).toEqual({ setup: [], copyFiles: [], teardown: [] })
    expect(
      parseWorktreeConfig({ 'setup-worktree': 'npm install', 'copy-files': ['.env', 3, null] })
    ).toEqual({ setup: [], copyFiles: ['.env'], teardown: [] })
  })
})

describe('isWorktreeConfigEmpty', () => {
  it('is true only when every list is empty', () => {
    expect(isWorktreeConfigEmpty({ setup: [], copyFiles: [], teardown: [] })).toBe(true)
    expect(isWorktreeConfigEmpty({ setup: [], copyFiles: ['.env'], teardown: [] })).toBe(false)
    expect(isWorktreeConfigEmpty({ setup: [], copyFiles: [], teardown: ['x'] })).toBe(false)
  })
})

describe('cleanList', () => {
  it('trims and drops blank lines', () => {
    expect(cleanList(['  npm install ', '', '   ', 'make'])).toEqual(['npm install', 'make'])
  })
})

describe('applyWorktreeConfig', () => {
  it('preserves unknown keys and removes emptied lists', () => {
    const target: Record<string, unknown> = {
      custom: 1,
      'setup-worktree': ['old'],
      'teardown-worktree': ['old teardown']
    }
    applyWorktreeConfig(target, { setup: ['npm ci'], copyFiles: ['.env'], teardown: [] })
    expect(target).toEqual({ custom: 1, 'setup-worktree': ['npm ci'], 'copy-files': ['.env'] })
  })
})
