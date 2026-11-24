import { describe, expect, it } from 'vitest'
import {
  expandCopyPatterns,
  invalidCopyPatterns,
  parseCopyPattern,
  segmentMatcher,
  selectCopyFiles,
  type DirEntry,
  type ListDir
} from './copy-files'

/** Build a ListDir over a flat list of file paths (plus optional symlink/other paths). */
function tree(files: string[], others: string[] = []): ListDir {
  return async (relDir) => {
    const prefix = relDir ? `${relDir}/` : ''
    const entries = new Map<string, DirEntry>()
    const add = (p: string, leafKind: 'file' | 'other'): void => {
      if (!p.startsWith(prefix)) return
      const rest = p.slice(prefix.length)
      const [name, ...more] = rest.split('/')
      if (more.length > 0) entries.set(name, { name, kind: 'dir' })
      else entries.set(name, { name, kind: leafKind })
    }
    for (const f of files) add(f, 'file')
    for (const o of others) add(o, 'other')
    return [...entries.values()]
  }
}

describe('parseCopyPattern', () => {
  it('splits a relative pattern into segments', () => {
    expect(parseCopyPattern('.env.local')).toEqual(['.env.local'])
    expect(parseCopyPattern('./config/*.local.json')).toEqual(['config', '*.local.json'])
    expect(parseCopyPattern(' a//b/ ')).toEqual(['a', 'b'])
  })

  it('rejects patterns that could leave the project root', () => {
    for (const bad of ['', '  ', '/etc/passwd', '../secrets', 'a/../../b', '~/x', 'C:/x', 'a\\b']) {
      expect(parseCopyPattern(bad)).toBeNull()
    }
    expect(invalidCopyPatterns(['.env', '../x', '/abs'])).toEqual(['../x', '/abs'])
  })
})

describe('segmentMatcher', () => {
  it('matches * and ? within one segment and escapes regex characters', () => {
    expect(segmentMatcher('*.local.json')('db.local.json')).toBe(true)
    expect(segmentMatcher('*.local.json')('dbXlocal.json')).toBe(false)
    expect(segmentMatcher('.env.?')('.env.a')).toBe(true)
    expect(segmentMatcher('.env.?')('.env.ab')).toBe(false)
    expect(segmentMatcher('a+b(1).txt')('a+b(1).txt')).toBe(true)
    expect(segmentMatcher('*')('.hidden')).toBe(true)
  })
})

describe('expandCopyPatterns', () => {
  const files = [
    '.env',
    '.env.local',
    'README.md',
    'config/app.json',
    'config/db.local.json',
    'config/nested/x.local.json',
    'packages/a/.env.local',
    'packages/b/.env.local',
    'node_modules/pkg/.env.local',
    '.git/config',
    'certs/dev.pem',
    'certs/ca/root.pem'
  ]

  it('matches literal and wildcard patterns at the right depth only', async () => {
    const r = await expandCopyPatterns(['.env.local', 'config/*.local.json'], tree(files))
    expect(r.files).toEqual(['.env.local', 'config/db.local.json'])
    expect(r.walkCapped).toBe(false)
  })

  it('expands ** across directories but never into node_modules or .git', async () => {
    const r = await expandCopyPatterns(['**/.env.local'], tree(files))
    expect(r.files).toEqual(['.env.local', 'packages/a/.env.local', 'packages/b/.env.local'])
    const all = await expandCopyPatterns(['**'], tree(files))
    expect(all.files.some((f) => f.startsWith('node_modules/') || f.startsWith('.git/'))).toBe(
      false
    )
    expect(all.files).toContain('certs/ca/root.pem')
  })

  it('skips those directories even when a pattern names them', async () => {
    const r = await expandCopyPatterns(['node_modules/pkg/.env.local', '.git/config'], tree(files))
    expect(r.files).toEqual([])
  })

  it('copies the files beneath a directory a pattern names', async () => {
    const r = await expandCopyPatterns(['certs'], tree(files))
    expect(r.files).toEqual(['certs/ca/root.pem', 'certs/dev.pem'])
  })

  it('ignores invalid patterns, symlinks and other non-regular entries', async () => {
    const r = await expandCopyPatterns(
      ['../outside', '/etc/hosts', 'link.env', 'linked/*'],
      tree(files, ['link.env', 'linked'])
    )
    expect(r.files).toEqual([])
  })

  it('dedupes files matched by several patterns', async () => {
    const r = await expandCopyPatterns(['.env*', '.env.local', '**/.env'], tree(files))
    expect(r.files).toEqual(['.env', '.env.local'])
  })

  it('reports when the entry budget runs out', async () => {
    const r = await expandCopyPatterns(['**'], tree(files), { maxEntries: 3 })
    expect(r.walkCapped).toBe(true)
    expect(r.files.length).toBeLessThan(files.length)
  })
})

describe('selectCopyFiles', () => {
  it('caps the file count', () => {
    const candidates = ['c', 'a', 'b'].map((path) => ({ path, size: 1 }))
    const r = selectCopyFiles(candidates, { maxFiles: 2, maxTotalBytes: 100 })
    expect(r.selected.map((c) => c.path)).toEqual(['a', 'b'])
    expect(r.overCap).toBe(1)
  })

  it('skips files that would exceed the size cap but keeps smaller later ones', () => {
    const r = selectCopyFiles(
      [
        { path: 'a', size: 6 },
        { path: 'b', size: 6 },
        { path: 'c', size: 3 }
      ],
      { maxFiles: 10, maxTotalBytes: 10 }
    )
    expect(r.selected.map((c) => c.path)).toEqual(['a', 'c'])
    expect(r.overCap).toBe(1)
  })
})
