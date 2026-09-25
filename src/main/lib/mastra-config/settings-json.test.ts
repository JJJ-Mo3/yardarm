import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mastraAppDataDir, setModeThinkingDefault, settingsJsonPath } from './settings-json'

describe('mastraAppDataDir', () => {
  let savedOverride: string | undefined

  beforeEach(() => {
    savedOverride = process.env.MASTRA_APP_DATA_DIR
  })

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.MASTRA_APP_DATA_DIR
    else process.env.MASTRA_APP_DATA_DIR = savedOverride
  })

  it('honors the MASTRA_APP_DATA_DIR override', () => {
    process.env.MASTRA_APP_DATA_DIR = '/tmp/mastra-test-data'
    expect(mastraAppDataDir()).toBe('/tmp/mastra-test-data')
  })

  it('resolves a mastracode dir under platform app data without the override', () => {
    delete process.env.MASTRA_APP_DATA_DIR
    expect(path.basename(mastraAppDataDir())).toBe('mastracode')
  })

  it('settingsJsonPath appends settings.json to the app data dir', () => {
    process.env.MASTRA_APP_DATA_DIR = '/tmp/mastra-test-data'
    expect(settingsJsonPath()).toBe(path.join('/tmp/mastra-test-data', 'settings.json'))
  })
})

describe('setModeThinkingDefault', () => {
  let savedOverride: string | undefined
  let dir: string

  beforeEach(async () => {
    savedOverride = process.env.MASTRA_APP_DATA_DIR
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yardarm-settings-'))
    process.env.MASTRA_APP_DATA_DIR = dir
  })

  afterEach(async () => {
    if (savedOverride === undefined) delete process.env.MASTRA_APP_DATA_DIR
    else process.env.MASTRA_APP_DATA_DIR = savedOverride
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('sets and clears a mode level, preserving unknown keys and the active pack', async () => {
    await fs.writeFile(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        cliOnlyKey: { nested: true },
        models: { activeModelPackId: 'pack-x', unknownModelKey: 'kept' }
      }),
      'utf8'
    )

    const afterSet = await setModeThinkingDefault('plan', 'high')
    expect(afterSet.models?.modeThinkingDefaults).toEqual({ plan: 'high' })
    // Unlike setModeDefault, thinking defaults must not clear the active pack.
    expect(afterSet.models?.activeModelPackId).toBe('pack-x')

    const afterClear = await setModeThinkingDefault('plan', null)
    expect(afterClear.models?.modeThinkingDefaults).toEqual({})

    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))
    expect(onDisk.cliOnlyKey).toEqual({ nested: true })
    expect(onDisk.models.unknownModelKey).toBe('kept')
    expect(onDisk.models.activeModelPackId).toBe('pack-x')
  })
})
