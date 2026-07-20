import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mastraAppDataDir, settingsJsonPath } from './settings-json'

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
