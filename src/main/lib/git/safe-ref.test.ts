import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertSafeRef, resolveInside } from './safe-ref'

describe('assertSafeRef', () => {
  it('accepts ordinary revisions', () => {
    for (const ref of ['HEAD', 'HEAD~2', 'origin/main', 'a1b2c3d', 'stash@{0}', 'feat/x#1']) {
      expect(assertSafeRef(ref)).toBe(ref)
    }
    expect(assertSafeRef('refs/yardarm/checkpoints/abc')).toBe('refs/yardarm/checkpoints/abc')
  })

  it('rejects option-looking, empty, and whitespace refs', () => {
    for (const ref of ['--output=/tmp/x', '-p', '', 'a b', 'a\nb', 'a\u0000b']) {
      expect(() => assertSafeRef(ref)).toThrow('Invalid git ref')
    }
  })
})

describe('resolveInside', () => {
  const root = path.resolve('/tmp/project')

  it('resolves paths under the root, tolerating a trailing separator on it', () => {
    expect(resolveInside(root, 'src/a.ts')).toBe(path.join(root, 'src', 'a.ts'))
    expect(resolveInside(root + path.sep, 'a.ts')).toBe(path.join(root, 'a.ts'))
    expect(resolveInside(root, '.')).toBe(root)
  })

  it('rejects traversal, absolute paths, and sibling-prefix escapes', () => {
    expect(() => resolveInside(root, '../secret')).toThrow('escapes')
    expect(() => resolveInside(root, path.resolve('/etc/passwd'))).toThrow('escapes')
    expect(() => resolveInside(root, '../project-evil/x')).toThrow('escapes')
  })
})
