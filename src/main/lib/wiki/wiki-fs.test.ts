/** Tests for the repo-wiki storage module (staging collect, traversal safety). */
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectStaging,
  deleteWiki,
  ensureExcludeLine,
  hasStagedPages,
  listPages,
  readMeta,
  readPage,
  wikiDir,
  WIKI_STAGING_DIR
} from './wiki-fs'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yardarm-wiki-test-'))
})

describe('wikiDir', () => {
  it('nests per project under userData/wiki', () => {
    expect(wikiDir('/data', 'p1')).toBe(path.join('/data', 'wiki', 'p1'))
  })
})

describe('listPages', () => {
  it('returns [] for a missing directory', async () => {
    expect(await listPages(path.join(dir, 'nope'))).toEqual([])
  })

  it('lists .md pages with index first and titles from headings', async () => {
    await writeFile(path.join(dir, 'beta.md'), 'no heading here')
    await writeFile(path.join(dir, 'alpha.md'), '# Alpha module\nbody')
    await writeFile(path.join(dir, 'index.md'), '# Overview')
    await writeFile(path.join(dir, 'meta.json'), '{}')
    expect(await listPages(dir)).toEqual([
      { name: 'index.md', title: 'Overview' },
      { name: 'alpha.md', title: 'Alpha module' },
      { name: 'beta.md', title: 'beta' }
    ])
  })
})

describe('readPage', () => {
  it('reads a valid page and rejects traversal or non-md names', async () => {
    await writeFile(path.join(dir, 'page.md'), 'content')
    expect(await readPage(dir, 'page.md')).toBe('content')
    expect(await readPage(dir, 'missing.md')).toBeNull()
    expect(await readPage(dir, '../page.md')).toBeNull()
    expect(await readPage(dir, 'meta.json')).toBeNull()
    expect(await readPage(dir, '.hidden.md')).toBeNull()
  })
})

describe('readMeta', () => {
  it('returns null when absent and parses sha/generatedAt when present', async () => {
    expect(await readMeta(dir)).toBeNull()
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ sha: 'abc', generatedAt: 5 }))
    expect(await readMeta(dir)).toEqual({ sha: 'abc', generatedAt: 5 })
  })
})

describe('collectStaging', () => {
  it('is a no-op without staged pages', async () => {
    expect(await collectStaging(dir, path.join(dir, 'store'))).toBe(false)
    await mkdir(path.join(dir, WIKI_STAGING_DIR))
    await writeFile(path.join(dir, WIKI_STAGING_DIR, 'meta.json'), '{"sha":"abc"}')
    expect(await hasStagedPages(dir)).toBe(false)
    expect(await collectStaging(dir, path.join(dir, 'store'))).toBe(false)
  })

  it('moves pages into the store, finalizes meta, and clears staging', async () => {
    const staging = path.join(dir, WIKI_STAGING_DIR)
    await mkdir(staging)
    await writeFile(path.join(staging, 'meta.json'), JSON.stringify({ sha: 'abc123' }))
    await writeFile(path.join(staging, 'index.md'), '# Overview')
    await writeFile(path.join(staging, 'agents.md'), '# Agents')
    await writeFile(path.join(staging, 'notes.txt'), 'ignored')
    const store = path.join(dir, 'store')
    // Pre-existing stale page must be replaced, not merged.
    await mkdir(store)
    await writeFile(path.join(store, 'old.md'), '# Old')

    expect(await collectStaging(dir, store)).toBe(true)
    expect((await readdir(store)).sort()).toEqual(['agents.md', 'index.md', 'meta.json'])
    expect(await readFile(path.join(store, 'index.md'), 'utf8')).toBe('# Overview')
    const meta = await readMeta(store)
    expect(meta?.sha).toBe('abc123')
    expect(meta?.generatedAt).toBeGreaterThan(0)
    // Staging is gone, so a second collect is a safe no-op.
    expect(await collectStaging(dir, store)).toBe(false)
  })
})

describe('ensureExcludeLine', () => {
  it('creates the file, appends once, and is idempotent', async () => {
    const file = path.join(dir, 'git', 'info', 'exclude')
    await ensureExcludeLine(file, '.yardarm-wiki/')
    await ensureExcludeLine(file, '.yardarm-wiki/')
    expect(await readFile(file, 'utf8')).toBe('.yardarm-wiki/\n')
  })

  it('appends to existing content without a trailing newline', async () => {
    const file = path.join(dir, 'exclude')
    await writeFile(file, 'node_modules')
    await ensureExcludeLine(file, '.yardarm-wiki/')
    expect(await readFile(file, 'utf8')).toBe('node_modules\n.yardarm-wiki/\n')
  })
})

describe('deleteWiki', () => {
  it('removes the store (and tolerates a missing one)', async () => {
    const store = path.join(dir, 'store')
    await mkdir(store)
    await writeFile(path.join(store, 'index.md'), '# Overview')
    await deleteWiki(store)
    expect(await listPages(store)).toEqual([])
    await deleteWiki(store)
  })
})
