import { describe, expect, it } from 'vitest'
import {
  comboLabel,
  detectConflicts,
  eventToCombo,
  normalizeCombo,
  resolveCombo,
  type ComboEventLike
} from './shortcut-registry'

const ev = (partial: Partial<ComboEventLike> & { key: string }): ComboEventLike => ({
  code: undefined,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...partial
})

describe('normalizeCombo', () => {
  it('lowercases and orders tokens mod → shift → key', () => {
    expect(normalizeCombo('Shift+Mod+K')).toBe('mod+shift+k')
    expect(normalizeCombo('mod+N')).toBe('mod+n')
  })
})

describe('eventToCombo', () => {
  it('maps meta combos', () => {
    expect(eventToCombo(ev({ key: 'k', metaKey: true }))).toBe('mod+k')
  })

  it('maps ctrl combos to the same mod token', () => {
    expect(eventToCombo(ev({ key: 'k', ctrlKey: true }))).toBe('mod+k')
  })

  it('normalizes shift+backslash reported as | to mod+shift+\\', () => {
    expect(eventToCombo(ev({ key: '|', metaKey: true, shiftKey: true, code: 'Backslash' }))).toBe(
      'mod+shift+\\'
    )
  })

  it('rejects alt combos, bare keys, and pure modifiers', () => {
    expect(eventToCombo(ev({ key: 'k', metaKey: true, altKey: true }))).toBeNull()
    expect(eventToCombo(ev({ key: 'k' }))).toBeNull()
    expect(eventToCombo(ev({ key: 'Meta', metaKey: true }))).toBeNull()
    expect(eventToCombo(ev({ key: 'Shift', metaKey: true, shiftKey: true }))).toBeNull()
  })

  it('rejects multi-character keys', () => {
    expect(eventToCombo(ev({ key: 'Enter', metaKey: true }))).toBeNull()
  })
})

describe('comboLabel', () => {
  it('formats mac labels with symbols', () => {
    expect(comboLabel('mod+shift+\\', true)).toBe('⌘⇧\\')
    expect(comboLabel('mod+k', true)).toBe('⌘K')
  })

  it('formats non-mac labels with Ctrl', () => {
    expect(comboLabel('mod+shift+\\', false)).toBe('Ctrl+Shift+\\')
    expect(comboLabel('mod+,', false)).toBe('Ctrl+,')
  })
})

describe('resolveCombo', () => {
  it('falls back to the default and applies overrides', () => {
    expect(resolveCombo('commandPalette', {})).toBe('mod+k')
    expect(resolveCombo('commandPalette', { commandPalette: 'mod+shift+k' })).toBe('mod+shift+k')
  })
})

describe('detectConflicts', () => {
  it('is empty for the defaults', () => {
    expect(detectConflicts({}).size).toBe(0)
  })

  it('flags two actions bound to the same combo', () => {
    const conflicts = detectConflicts({ quickOpen: 'mod+k' })
    expect(conflicts.has('quickOpen')).toBe(true)
    expect(conflicts.has('commandPalette')).toBe(true)
    expect(conflicts.has('newChat')).toBe(false)
  })

  it('flags collisions with the fixed mod+1–8 tab shortcuts', () => {
    const conflicts = detectConflicts({ newChat: 'mod+3' })
    expect(conflicts.has('newChat')).toBe(true)
  })
})
