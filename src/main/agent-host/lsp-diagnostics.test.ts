import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  fallbackLanguageId,
  findExecutable,
  lspUriCandidates,
  mapLspDiagnostics
} from './lsp-diagnostics'

describe('lspUriCandidates', () => {
  it('returns raw and percent-encoded URIs for paths with spaces', () => {
    expect(lspUriCandidates('/Users/me/Library/Application Support/wt/bad.ts')).toEqual([
      'file:///Users/me/Library/Application Support/wt/bad.ts',
      'file:///Users/me/Library/Application%20Support/wt/bad.ts'
    ])
  })

  it('returns a single URI when encoding changes nothing', () => {
    expect(lspUriCandidates('/tmp/project/main.rs')).toEqual(['file:///tmp/project/main.rs'])
  })
})

describe('fallbackLanguageId', () => {
  it('maps Ruby extensions and well-known basenames', () => {
    expect(fallbackLanguageId('/app/models/user.rb')).toBe('ruby')
    expect(fallbackLanguageId('/app/tasks/build.rake')).toBe('ruby')
    expect(fallbackLanguageId('/app/my_gem.gemspec')).toBe('ruby')
    expect(fallbackLanguageId('/app/Gemfile')).toBe('ruby')
    expect(fallbackLanguageId('/app/Rakefile')).toBe('ruby')
  })

  it('maps .erb including the .html.erb double extension', () => {
    expect(fallbackLanguageId('/app/views/users/show.html.erb')).toBe('erb')
    expect(fallbackLanguageId('/app/views/mail.text.ERB')).toBe('erb')
  })

  it('returns undefined for extensions it does not know', () => {
    expect(fallbackLanguageId('/app/main.swift')).toBeUndefined()
    expect(fallbackLanguageId('/app/gemfile')).toBeUndefined()
  })
})

describe('findExecutable', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'yardarm-lsp-'))
  const pathDir = path.join(tmp, 'onpath')
  const extraDir = path.join(tmp, 'extra')
  const emptyDir = path.join(tmp, 'empty')
  mkdirSync(pathDir)
  mkdirSync(extraDir)
  mkdirSync(emptyDir)
  writeFileSync(path.join(pathDir, 'gopls'), '#!/bin/sh\n')
  chmodSync(path.join(pathDir, 'gopls'), 0o755)
  writeFileSync(path.join(extraDir, 'ruby-lsp'), '#!/bin/sh\n')
  chmodSync(path.join(extraDir, 'ruby-lsp'), 0o755)
  writeFileSync(path.join(extraDir, 'not-exec'), 'data')
  chmodSync(path.join(extraDir, 'not-exec'), 0o644)

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('finds an executable via the PATH env value', () => {
    const env = [emptyDir, pathDir].join(path.delimiter)
    expect(findExecutable('gopls', env, [])).toBe(path.join(pathDir, 'gopls'))
  })

  it('falls back to extra well-known dirs when PATH misses', () => {
    expect(findExecutable('ruby-lsp', emptyDir, [extraDir])).toBe(path.join(extraDir, 'ruby-lsp'))
  })

  it('returns null when the binary is nowhere', () => {
    expect(findExecutable('rust-analyzer', emptyDir, [extraDir])).toBeNull()
  })

  it('skips non-executable files and tolerates an unset PATH', () => {
    expect(findExecutable('not-exec', undefined, [extraDir])).toBeNull()
  })
})

describe('mapLspDiagnostics', () => {
  it('converts 0-based LSP positions to 1-based and maps severities', () => {
    const raw = [
      {
        range: { start: { line: 4, character: 2 }, end: { line: 4, character: 9 } },
        severity: 1,
        message: "Cannot find name 'foo'.",
        source: 'ts'
      },
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        severity: 2,
        message: 'Unused variable',
        source: 'eslint'
      }
    ]
    const mapped = mapLspDiagnostics(raw)
    expect(mapped).toEqual([
      {
        line: 1,
        col: 1,
        endLine: 1,
        endCol: 6,
        severity: 'warning',
        message: 'Unused variable',
        source: 'eslint'
      },
      {
        line: 5,
        col: 3,
        endLine: 5,
        endCol: 10,
        severity: 'error',
        message: "Cannot find name 'foo'.",
        source: 'ts'
      }
    ])
  })

  it('maps info and hint severities and defaults unknown severity to info', () => {
    const mapped = mapLspDiagnostics([
      { range: { start: { line: 1, character: 0 } }, severity: 3, message: 'note' },
      { range: { start: { line: 2, character: 0 } }, severity: 4, message: 'hint' },
      { range: { start: { line: 3, character: 0 } }, message: 'no severity' }
    ])
    expect(mapped.map((d) => d.severity)).toEqual(['info', 'hint', 'info'])
  })

  it('tolerates missing ranges and drops malformed entries', () => {
    const mapped = mapLspDiagnostics([
      { message: 'no range at all' },
      null,
      42,
      { range: { start: { line: 2 } }, severity: 1, message: 'partial' },
      { severity: 1 } // no message → dropped
    ])
    expect(mapped).toEqual([
      { line: 1, col: 1, endLine: 1, endCol: 1, severity: 'info', message: 'no range at all' },
      { line: 3, col: 1, endLine: 3, endCol: 1, severity: 'error', message: 'partial' }
    ])
  })

  it('returns [] for non-array input', () => {
    expect(mapLspDiagnostics(undefined)).toEqual([])
    expect(mapLspDiagnostics({})).toEqual([])
  })
})
