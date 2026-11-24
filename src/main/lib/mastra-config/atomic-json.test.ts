import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { queuedForFile, writeJsonAtomic } from './atomic-json'
import { readJsonForUpdate } from './settings-json'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yardarm-atomic-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('queuedForFile + writeJsonAtomic', () => {
  it('serializes read-modify-writes so no concurrent update is lost', async () => {
    const file = path.join(dir, 'c.json')
    const bump = (key: string): Promise<void> =>
      queuedForFile(file, async () => {
        const cur = await readJsonForUpdate<Record<string, number>>(file)
        await new Promise((r) => setTimeout(r, 5))
        cur[key] = 1
        await writeJsonAtomic(file, cur)
      })
    await Promise.all(['a', 'b', 'c', 'd'].map(bump))
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ a: 1, b: 1, c: 1, d: 1 })
    expect((await fs.readdir(dir)).sort()).toEqual(['c.json'])
  })

  it('keeps running after a failed task', async () => {
    const file = path.join(dir, 'c.json')
    await expect(queuedForFile(file, () => Promise.reject(new Error('boom')))).rejects.toThrow()
    await queuedForFile(file, () => writeJsonAtomic(file, { ok: true }))
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ ok: true })
  })
})

describe('readJsonForUpdate', () => {
  it('treats a missing or empty file as an empty config', async () => {
    expect(await readJsonForUpdate(path.join(dir, 'missing.json'))).toEqual({})
    const empty = path.join(dir, 'empty.json')
    await fs.writeFile(empty, '  \n')
    expect(await readJsonForUpdate(empty)).toEqual({})
  })

  it('refuses unparseable or non-object content instead of returning {}', async () => {
    const bad = path.join(dir, 'bad.json')
    await fs.writeFile(bad, '{ "a": 1, ')
    await expect(readJsonForUpdate(bad)).rejects.toThrow('not valid JSON')
    await fs.writeFile(bad, '[1,2]')
    await expect(readJsonForUpdate(bad)).rejects.toThrow('not valid JSON')
  })
})
