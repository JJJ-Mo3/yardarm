/**
 * Read/write mastracode's global settings.json (shared with the CLI).
 *
 * The file lives in the platform app-data dir — the same place the SDK's
 * getAppDataDir() resolves (~/Library/Application Support/mastracode on
 * macOS, %APPDATA%/mastracode on Windows, ~/.local/share/mastracode on
 * Linux), honoring the MASTRA_APP_DATA_DIR override.
 *
 * Writes are queued in-process and each performs a fresh read → mutate →
 * atomic tmp+rename, preserving unknown keys. The file is shared with the
 * CLI, so we never cache contents across mutations (last-writer-wins).
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  BrowserSettingsPatch,
  CustomProviderSetting,
  MastraSettings,
  OmDefaultsPatch,
  PreferencesPatch,
  VoiceSettingsPatch
} from '../../../shared/mastra-settings'

export function mastraAppDataDir(): string {
  if (process.env.MASTRA_APP_DATA_DIR) return process.env.MASTRA_APP_DATA_DIR
  const platform = os.platform()
  let baseDir: string
  if (platform === 'darwin') {
    baseDir = path.join(os.homedir(), 'Library', 'Application Support')
  } else if (platform === 'win32') {
    baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  } else {
    baseDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  }
  return path.join(baseDir, 'mastracode')
}

export function settingsJsonPath(): string {
  return path.join(mastraAppDataDir(), 'settings.json')
}

export async function readSettings(): Promise<MastraSettings> {
  try {
    const raw = await fs.readFile(settingsJsonPath(), 'utf8')
    return JSON.parse(raw) as MastraSettings
  } catch {
    return {}
  }
}

let writeQueue: Promise<unknown> = Promise.resolve()

/**
 * Queued read-modify-write. The mutator receives the freshly-read settings
 * object and edits it in place; unknown keys survive untouched.
 */
export function updateSettings(mutate: (s: MastraSettings) => void): Promise<MastraSettings> {
  const task = writeQueue.then(async () => {
    const settings = await readSettings()
    mutate(settings)
    const file = settingsJsonPath()
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
    await fs.rename(tmp, file)
    return settings
  })
  // Keep the queue alive even if this write fails.
  writeQueue = task.catch(() => {})
  return task
}

function models(s: MastraSettings): NonNullable<MastraSettings['models']> {
  if (!s.models) s.models = {}
  return s.models
}

/** Set an explicit per-mode default; clears the active pack (manual override). */
export function setModeDefault(mode: string, modelId: string | null): Promise<MastraSettings> {
  return updateSettings((s) => {
    const m = models(s)
    const defaults = { ...(m.modeDefaults ?? {}) }
    if (modelId) defaults[mode] = modelId
    else delete defaults[mode]
    m.modeDefaults = defaults
    m.activeModelPackId = null
  })
}

export function setSubagentModel(
  agentType: string,
  modelId: string | null
): Promise<MastraSettings> {
  return updateSettings((s) => {
    const m = models(s)
    const map = { ...(m.subagentModels ?? {}) }
    if (modelId) map[agentType] = modelId
    else delete map[agentType]
    m.subagentModels = map
  })
}

export function setGoalDefaults(patch: {
  judgeModel?: string | null
  maxTurns?: number | null
}): Promise<MastraSettings> {
  return updateSettings((s) => {
    const m = models(s)
    if (patch.judgeModel !== undefined) m.goalJudgeModel = patch.judgeModel
    if (patch.maxTurns !== undefined) m.goalMaxTurns = patch.maxTurns
  })
}

/** Manual OM overrides clear the active OM pack, matching /om semantics. */
export function setOmDefaults(patch: OmDefaultsPatch): Promise<MastraSettings> {
  return updateSettings((s) => {
    const m = models(s)
    if (
      patch.observerModelOverride !== undefined ||
      patch.reflectorModelOverride !== undefined ||
      patch.omModelOverride !== undefined
    ) {
      m.activeOmPackId = null
    }
    if (patch.observerModelOverride !== undefined)
      m.observerModelOverride = patch.observerModelOverride
    if (patch.reflectorModelOverride !== undefined)
      m.reflectorModelOverride = patch.reflectorModelOverride
    if (patch.omModelOverride !== undefined) m.omModelOverride = patch.omModelOverride
    if (patch.omObservationThreshold !== undefined)
      m.omObservationThreshold = patch.omObservationThreshold
    if (patch.omReflectionThreshold !== undefined)
      m.omReflectionThreshold = patch.omReflectionThreshold
    if (patch.omCavemanObservations !== undefined)
      m.omCavemanObservations = patch.omCavemanObservations
  })
}

export function setPreference(key: string, value: unknown): Promise<MastraSettings> {
  return updateSettings((s) => {
    if (!s.preferences) s.preferences = {}
    s.preferences[key] = value
  })
}

export function setPreferences(patch: PreferencesPatch): Promise<MastraSettings> {
  return updateSettings((s) => {
    if (!s.preferences) s.preferences = {}
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) s.preferences[k] = v
    }
  })
}

export function setVoiceSettings(patch: VoiceSettingsPatch): Promise<MastraSettings> {
  return updateSettings((s) => {
    if (!s.voice) s.voice = {}
    if (patch.enabled !== undefined) s.voice.enabled = patch.enabled
    if (patch.engine !== undefined) s.voice.engine = patch.engine
    if (patch.provider !== undefined) s.voice.provider = patch.provider
    if (patch.model !== undefined) {
      if (patch.model === null) delete s.voice.model
      else s.voice.model = patch.model
    }
  })
}

export function setBrowserSettings(patch: BrowserSettingsPatch): Promise<MastraSettings> {
  return updateSettings((s) => {
    if (!s.browser) s.browser = {}
    const b = s.browser
    const setOrDelete = (obj: Record<string, unknown>, key: string, v: unknown): void => {
      if (v === undefined) return
      if (v === null || v === '') delete obj[key]
      else obj[key] = v
    }
    if (patch.enabled !== undefined) b.enabled = patch.enabled
    if (patch.provider !== undefined) b.provider = patch.provider
    if (patch.headless !== undefined) b.headless = patch.headless
    setOrDelete(b, 'cdpUrl', patch.cdpUrl)
    setOrDelete(b, 'profile', patch.profile)
    setOrDelete(b, 'executablePath', patch.executablePath)
    setOrDelete(b, 'scope', patch.scope)
    if (patch.stagehand) {
      if (!b.stagehand) b.stagehand = {}
      if (patch.stagehand.env !== undefined) b.stagehand.env = patch.stagehand.env
      if (patch.stagehand.preserveUserDataDir !== undefined)
        b.stagehand.preserveUserDataDir = patch.stagehand.preserveUserDataDir
      setOrDelete(b.stagehand, 'apiKey', patch.stagehand.apiKey)
      setOrDelete(b.stagehand, 'projectId', patch.stagehand.projectId)
    }
    if (patch.agentBrowser) {
      if (!b.agentBrowser) b.agentBrowser = {}
      setOrDelete(b.agentBrowser, 'storageState', patch.agentBrowser.storageState)
    }
  })
}

/**
 * Activate a model pack. Built-in packs clear manual mode defaults (models
 * resolve from the pack at boot); custom packs pin their models as the
 * defaults, matching the CLI's /models pack semantics. `null` deactivates.
 */
export function setActiveModelPack(
  packId: string | null,
  packModels?: Record<string, string>
): Promise<MastraSettings> {
  return updateSettings((s) => {
    const m = models(s)
    m.activeModelPackId = packId
    if (packId) {
      m.modeDefaults = packId.startsWith('custom:') ? { ...(packModels ?? {}) } : {}
      m.subagentModels = {}
    }
  })
}

/** Activate an OM pack; clears manual OM model overrides so the pack applies. */
export function setOmPack(packId: string | null): Promise<MastraSettings> {
  return updateSettings((s) => {
    const m = models(s)
    m.activeOmPackId = packId
    if (packId) {
      m.omModelOverride = null
      m.observerModelOverride = null
      m.reflectorModelOverride = null
    }
  })
}

export function saveCustomPack(
  name: string,
  packModels: Record<string, string>
): Promise<MastraSettings> {
  return updateSettings((s) => {
    const list = [...(s.customModelPacks ?? [])]
    const entry = { name, models: packModels, createdAt: new Date().toISOString() }
    const idx = list.findIndex((p) => p.name === name)
    if (idx >= 0) list[idx] = { ...list[idx], ...entry }
    else list.push(entry)
    s.customModelPacks = list
  })
}

export function deleteCustomPack(name: string): Promise<MastraSettings> {
  return updateSettings((s) => {
    s.customModelPacks = (s.customModelPacks ?? []).filter((p) => p.name !== name)
    const m = models(s)
    if (m.activeModelPackId === `custom:${name}`) m.activeModelPackId = null
  })
}

export function upsertCustomProvider(provider: CustomProviderSetting): Promise<MastraSettings> {
  return updateSettings((s) => {
    const list = [...(s.customProviders ?? [])]
    const idx = list.findIndex((p) => p.name === provider.name)
    if (idx >= 0) list[idx] = { ...list[idx], ...provider }
    else list.push(provider)
    s.customProviders = list
  })
}

export function removeCustomProvider(name: string): Promise<MastraSettings> {
  return updateSettings((s) => {
    s.customProviders = (s.customProviders ?? []).filter((p) => p.name !== name)
  })
}
