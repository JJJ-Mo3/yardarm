import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mastraAppDataDir,
  setModePackOverride,
  setModeThinkingDefault,
  setPackAccountPreference,
  setPackFallback,
  settingsJsonPath
} from './settings-json'

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

describe('pack tuning writers', () => {
  let savedOverride: string | undefined
  let dir: string

  beforeEach(async () => {
    savedOverride = process.env.MASTRA_APP_DATA_DIR
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yardarm-settings-'))
    process.env.MASTRA_APP_DATA_DIR = dir
    await fs.writeFile(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        cliOnlyKey: 'kept',
        models: { activeModelPackId: 'pack-x', unknownModelKey: 'kept' }
      }),
      'utf8'
    )
  })

  afterEach(async () => {
    if (savedOverride === undefined) delete process.env.MASTRA_APP_DATA_DIR
    else process.env.MASTRA_APP_DATA_DIR = savedOverride
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('setModePackOverride sets/clears and drops empty pack sub-objects', async () => {
    const afterSet = await setModePackOverride('pack-x', 'build', 'openai/gpt-5.5')
    expect(afterSet.models?.modePackOverrides).toEqual({ 'pack-x': { build: 'openai/gpt-5.5' } })
    // No side effect on the active pack.
    expect(afterSet.models?.activeModelPackId).toBe('pack-x')

    const afterClear = await setModePackOverride('pack-x', 'build', null)
    expect(afterClear.models?.modePackOverrides).toEqual({})

    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))
    expect(onDisk.cliOnlyKey).toBe('kept')
    expect(onDisk.models.unknownModelKey).toBe('kept')
  })

  it('setPackFallback sets/clears the fallback pack', async () => {
    const afterSet = await setPackFallback('pack-x', 'pack-y')
    expect(afterSet.models?.packFallbacks).toEqual({ 'pack-x': 'pack-y' })
    expect(afterSet.models?.activeModelPackId).toBe('pack-x')

    const afterClear = await setPackFallback('pack-x', null)
    expect(afterClear.models?.packFallbacks).toEqual({})

    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))
    expect(onDisk.cliOnlyKey).toBe('kept')
    expect(onDisk.models.unknownModelKey).toBe('kept')
  })

  it('setPackAccountPreference sets/clears and drops empty pack sub-objects', async () => {
    const afterSet = await setPackAccountPreference('pack-x', 'anthropic/claude-4', 'acct-1')
    expect(afterSet.models?.packAccountPreferences).toEqual({
      'pack-x': { 'anthropic/claude-4': 'acct-1' }
    })
    expect(afterSet.models?.activeModelPackId).toBe('pack-x')

    const afterClear = await setPackAccountPreference('pack-x', 'anthropic/claude-4', null)
    expect(afterClear.models?.packAccountPreferences).toEqual({})

    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))
    expect(onDisk.cliOnlyKey).toBe('kept')
    expect(onDisk.models.unknownModelKey).toBe('kept')
  })
})
