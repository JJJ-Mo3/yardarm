/**
 * Composer draft persistence: unsent prompt text survives thread switches and
 * app restarts. All drafts live in one localStorage JSON map keyed by
 * subchatId, capped at ~4MB with oldest-first eviction.
 */

const STORAGE_KEY = 'cz.composerDrafts'
const MAX_BYTES = 4 * 1024 * 1024

type DraftMap = Record<string, { text: string; updatedAt: number }>

function readMap(): DraftMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as DraftMap) : {}
  } catch {
    return {}
  }
}

function writeMap(map: DraftMap): void {
  try {
    let json = JSON.stringify(map)
    // Evict oldest drafts until the map fits the cap.
    while (json.length > MAX_BYTES) {
      const oldest = Object.entries(map).sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
      if (!oldest) break
      delete map[oldest[0]]
      json = JSON.stringify(map)
    }
    localStorage.setItem(STORAGE_KEY, json)
  } catch {}
}

export function loadDraft(key: string): string | null {
  const entry = readMap()[key]
  return entry?.text ?? null
}

export function saveDraft(key: string, text: string): void {
  const map = readMap()
  if (!text.trim()) {
    if (!(key in map)) return
    delete map[key]
  } else {
    map[key] = { text, updatedAt: Date.now() }
  }
  writeMap(map)
}

export function clearDraft(key: string): void {
  saveDraft(key, '')
}
