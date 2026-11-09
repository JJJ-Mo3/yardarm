/** Tests for inline-code file-reference parsing (ask citations → IDE links). */
import { describe, expect, it } from 'vitest'
import { parseFileRef } from './file-refs'

describe('parseFileRef', () => {
  it('parses a plain repo-relative path', () => {
    expect(parseFileRef('src/main/index.ts')).toEqual({ path: 'src/main/index.ts' })
  })

  it('parses path:line', () => {
    expect(parseFileRef('src/main/index.ts:42')).toEqual({ path: 'src/main/index.ts', line: 42 })
  })

  it('parses path:start-end ranges to the start line', () => {
    expect(parseFileRef('src/shared/ipc-types.ts:10-20')).toEqual({
      path: 'src/shared/ipc-types.ts',
      line: 10
    })
    expect(parseFileRef('a/b.ts:10–20')).toEqual({ path: 'a/b.ts', line: 10 })
  })

  it('parses path:line:col to the line', () => {
    expect(parseFileRef('src/x.ts:12:5')).toEqual({ path: 'src/x.ts', line: 12 })
  })

  it('accepts slash-less names only with a known extension', () => {
    expect(parseFileRef('package.json')).toEqual({ path: 'package.json' })
    expect(parseFileRef('README.md:3')).toEqual({ path: 'README.md', line: 3 })
    expect(parseFileRef('foobar')).toBeNull()
    expect(parseFileRef('npm')).toBeNull()
  })

  it('strips a leading ./', () => {
    expect(parseFileRef('./src/a.ts:1')).toEqual({ path: 'src/a.ts', line: 1 })
  })

  it('rejects URLs', () => {
    expect(parseFileRef('https://example.com/a.ts')).toBeNull()
    expect(parseFileRef('file:///tmp/a.ts')).toBeNull()
  })

  it('rejects timestamps, versions, and numbers', () => {
    expect(parseFileRef('12:34')).toBeNull()
    expect(parseFileRef('1.2.3')).toBeNull()
    expect(parseFileRef('v2.0')).toBeNull()
    expect(parseFileRef('3:1')).toBeNull()
  })

  it('rejects shell-ish and free text', () => {
    expect(parseFileRef('pnpm run build')).toBeNull()
    expect(parseFileRef('--flag')).toBeNull()
    expect(parseFileRef('a || b')).toBeNull()
    expect(parseFileRef('')).toBeNull()
  })

  it('rejects directory-looking refs', () => {
    expect(parseFileRef('src/main/')).toBeNull()
    expect(parseFileRef('src//main.ts')).toBeNull()
  })

  it('rejects line 0', () => {
    expect(parseFileRef('src/a.ts:0')).toBeNull()
  })
})
