import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { setupCommandsHash, worktreeConfigHash } from './setup-hash'

describe('setupCommandsHash', () => {
  it('is stable for the same commands', () => {
    expect(setupCommandsHash(['npm install'])).toBe(setupCommandsHash(['npm install']))
  })

  it('changes when a command is edited, added, or reordered', () => {
    const base = setupCommandsHash(['npm install', 'npm run codegen'])
    expect(setupCommandsHash(['npm install', 'npm run codegen '])).not.toBe(base)
    expect(setupCommandsHash(['npm install'])).not.toBe(base)
    expect(setupCommandsHash(['npm run codegen', 'npm install'])).not.toBe(base)
  })

  it('does not confuse one command containing a separator with two commands', () => {
    expect(setupCommandsHash(['a","b'])).not.toBe(setupCommandsHash(['a', 'b']))
  })
})

describe('worktreeConfigHash', () => {
  it('equals the commands-only hash when there are no copy patterns or teardown commands', () => {
    const setup = ['npm install', 'npm run codegen']
    expect(worktreeConfigHash({ setup, copyFiles: [], teardown: [] })).toBe(
      setupCommandsHash(setup)
    )
    // Pinned vector: approvals stored before the extra lists existed stay valid.
    expect(worktreeConfigHash({ setup: ['npm install'], copyFiles: [], teardown: [] })).toBe(
      createHash('sha256').update('["npm install"]').digest('hex')
    )
  })

  it('changes when copy patterns or teardown commands are added or edited', () => {
    const setup = ['npm install']
    const base = worktreeConfigHash({ setup, copyFiles: [], teardown: [] })
    const withCopy = worktreeConfigHash({ setup, copyFiles: ['.env.local'], teardown: [] })
    const withTeardown = worktreeConfigHash({ setup, copyFiles: [], teardown: ['make clean'] })
    expect(withCopy).not.toBe(base)
    expect(withTeardown).not.toBe(base)
    expect(withCopy).not.toBe(withTeardown)
    expect(worktreeConfigHash({ setup, copyFiles: ['.env'], teardown: [] })).not.toBe(withCopy)
    expect(
      worktreeConfigHash({ setup, copyFiles: ['.env.local'], teardown: ['make clean'] })
    ).not.toBe(withCopy)
  })

  it('does not confuse an entry moved between lists', () => {
    const a = worktreeConfigHash({ setup: [], copyFiles: ['x'], teardown: [] })
    const b = worktreeConfigHash({ setup: [], copyFiles: [], teardown: ['x'] })
    const c = worktreeConfigHash({ setup: ['x'], copyFiles: [], teardown: [] })
    expect(new Set([a, b, c]).size).toBe(3)
  })
})
