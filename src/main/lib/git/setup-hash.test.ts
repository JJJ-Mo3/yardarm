import { describe, expect, it } from 'vitest'
import { setupCommandsHash } from './setup-hash'

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
