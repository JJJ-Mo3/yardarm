/**
 * Pure keyboard-shortcut registry: action catalog, combo normalization,
 * event→combo mapping, display labels, and conflict detection. No DOM or
 * `navigator` access at module scope so it stays testable in vitest's node
 * environment — platform (mac vs other) is passed in where labels need it.
 *
 * Combo format: lowercase tokens joined with '+', ordered mod → shift → key,
 * e.g. 'mod+n', 'mod+shift+\\'. 'mod' matches ⌘ on macOS and Ctrl elsewhere.
 * ⌘1–8 tab switching is fixed (not rebindable) but participates in conflict
 * detection so users can't shadow it.
 */

export type ShortcutActionId =
  | 'newChat'
  | 'commandPalette'
  | 'quickOpen'
  | 'threadSwitcher'
  | 'toggleTerminal'
  | 'settings'
  | 'splitAdd'
  | 'splitClose'
  | 'find'

export type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>

export interface ShortcutDef {
  id: ShortcutActionId
  /** Human label shown in Settings → Keyboard and the command palette. */
  label: string
  /** Settings grouping header. */
  group: string
  defaultCombo: string
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'newChat', label: 'New chat', group: 'General', defaultCombo: 'mod+n' },
  { id: 'commandPalette', label: 'Command palette', group: 'General', defaultCombo: 'mod+k' },
  { id: 'quickOpen', label: 'Quick file open', group: 'General', defaultCombo: 'mod+o' },
  { id: 'threadSwitcher', label: 'Thread switcher', group: 'General', defaultCombo: 'mod+p' },
  { id: 'settings', label: 'Settings', group: 'General', defaultCombo: 'mod+,' },
  { id: 'toggleTerminal', label: 'Toggle terminal tab', group: 'Tabs', defaultCombo: 'mod+j' },
  { id: 'splitAdd', label: 'Add split chat pane', group: 'Split view', defaultCombo: 'mod+\\' },
  {
    id: 'splitClose',
    label: 'Close last split pane',
    group: 'Split view',
    defaultCombo: 'mod+shift+\\'
  },
  { id: 'find', label: 'Find in chat / terminal', group: 'Search', defaultCombo: 'mod+f' }
]

/** Fixed, non-rebindable combos (⌘1–8 main-tab switching). */
export const FIXED_COMBOS = new Set(Array.from({ length: 8 }, (_, i) => `mod+${i + 1}`))

/** Lowercase and reorder tokens into the canonical mod → shift → key order. */
export function normalizeCombo(combo: string): string {
  const tokens = combo.toLowerCase().split('+')
  // The key may itself be '+' (combo 'mod++'), which split() turns into ''.
  const key = tokens[tokens.length - 1] || '+'
  const mods = new Set(tokens.slice(0, -1))
  const out: string[] = []
  if (mods.has('mod')) out.push('mod')
  if (mods.has('shift')) out.push('shift')
  out.push(key)
  return out.join('+')
}

/** The subset of KeyboardEvent that eventToCombo needs (testable shape). */
export interface ComboEventLike {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const MODIFIER_KEYS = new Set(['meta', 'control', 'shift', 'alt'])

/**
 * Map a keydown to a canonical combo string, or null when it can't be a
 * registry shortcut: no mod held, alt held (reserved for text entry), or a
 * pure-modifier press. The Backslash quirk (Shift+\ reports '|' on US
 * layouts) is centralized here.
 */
export function eventToCombo(e: ComboEventLike): string | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod || e.altKey) return null
  let key = e.key.toLowerCase()
  if (MODIFIER_KEYS.has(key)) return null
  if (key === '\\' || key === '|' || e.code === 'Backslash') key = '\\'
  if (key.length !== 1) return null
  return `mod${e.shiftKey ? '+shift' : ''}+${key}`
}

/** Display label for a combo: '⌘⇧\' on mac, 'Ctrl+Shift+\' elsewhere. */
export function comboLabel(combo: string, mac: boolean): string {
  const normalized = normalizeCombo(combo)
  const key = normalized.slice(normalized.lastIndexOf('+') + 1) || '+'
  const shift = normalized.includes('shift+')
  const keyLabel = key.toUpperCase()
  if (mac) return `⌘${shift ? '⇧' : ''}${keyLabel}`
  return `Ctrl+${shift ? 'Shift+' : ''}${keyLabel}`
}

/** The effective combo for an action: the user's override or the default. */
export function resolveCombo(id: ShortcutActionId, overrides: ShortcutOverrides): string {
  const override = overrides[id]
  const def = SHORTCUT_DEFS.find((d) => d.id === id)
  return normalizeCombo(override ?? def?.defaultCombo ?? '')
}

/**
 * Actions whose effective combo collides with another action or with the
 * fixed ⌘1–8 tab shortcuts. Conflicting bindings still persist — the UI
 * highlights them so the user can resolve the clash.
 */
export function detectConflicts(overrides: ShortcutOverrides): Set<ShortcutActionId> {
  const byCombo = new Map<string, ShortcutActionId[]>()
  for (const def of SHORTCUT_DEFS) {
    const combo = resolveCombo(def.id, overrides)
    byCombo.set(combo, [...(byCombo.get(combo) ?? []), def.id])
  }
  const conflicted = new Set<ShortcutActionId>()
  for (const [combo, ids] of byCombo) {
    if (ids.length > 1 || FIXED_COMBOS.has(combo)) for (const id of ids) conflicted.add(id)
  }
  return conflicted
}
