import { describe, expect, it } from 'vitest'
import { isSafeToDeleteDir } from './safe-delete-dir'

const HOME = '/Users/me'

describe('isSafeToDeleteDir', () => {
  it('rejects relative paths', () => {
    expect(isSafeToDeleteDir('dev/project', HOME)).toBe(false)
    expect(isSafeToDeleteDir('./project', HOME)).toBe(false)
  })

  it('rejects the filesystem root', () => {
    expect(isSafeToDeleteDir('/', HOME)).toBe(false)
  })

  it('rejects the home directory itself', () => {
    expect(isSafeToDeleteDir('/Users/me', HOME)).toBe(false)
  })

  it('rejects ancestors of the home directory', () => {
    expect(isSafeToDeleteDir('/Users', HOME)).toBe(false)
  })

  it('rejects normalized variants of home and its ancestors', () => {
    expect(isSafeToDeleteDir('/Users/me/', HOME)).toBe(false)
    expect(isSafeToDeleteDir('/Users/me/dev/..', HOME)).toBe(false)
    expect(isSafeToDeleteDir('/Users/other/../me', HOME)).toBe(false)
  })

  it('accepts a normal project folder', () => {
    expect(isSafeToDeleteDir('/Users/me/dev/project', HOME)).toBe(true)
    expect(isSafeToDeleteDir('/tmp/scratch-repo', HOME)).toBe(true)
  })

  it('accepts a sibling whose name is a prefix of home', () => {
    // /Users/mel is not an ancestor of /Users/me — the separator check matters.
    expect(isSafeToDeleteDir('/Users/mel', HOME)).toBe(true)
  })
})
