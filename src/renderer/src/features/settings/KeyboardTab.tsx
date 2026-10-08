/**
 * Settings → Keyboard: rebind app shortcuts. Rows are grouped by area; the
 * Record button captures the next keydown (Esc cancels, Backspace resets to
 * the default). Overrides persist in app_settings 'keyboardShortcuts' and
 * apply immediately via shortcutOverridesAtom. Conflicting bindings persist
 * but are highlighted so the user can resolve them. ⌘1–8 tab switching is
 * fixed and not listed.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import { RotateCcw } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { shortcutOverridesAtom } from '../../lib/atoms'
import { isMac } from '../../lib/shortcuts'
import {
  SHORTCUT_DEFS,
  FIXED_COMBOS,
  comboLabel,
  detectConflicts,
  eventToCombo,
  normalizeCombo,
  resolveCombo,
  type ShortcutActionId,
  type ShortcutOverrides
} from '../../lib/shortcut-registry'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'

const SETTINGS_KEY = 'keyboardShortcuts'

export function KeyboardTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const [overrides, setOverrides] = useAtom(shortcutOverridesAtom)
  const save = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: SETTINGS_KEY })
  })
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const persist = (next: ShortcutOverrides): void => {
    setOverrides(next)
    save.mutate({ key: SETTINGS_KEY, value: next })
  }

  // While recording, capture the next keydown before anything else sees it.
  useEffect(() => {
    if (!recordingId) return
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const next = { ...overrides }
        delete next[recordingId]
        persist(next)
        setRecordingId(null)
        return
      }
      const combo = eventToCombo(e)
      if (!combo) {
        // Pure-modifier presses are just the user forming a chord — wait.
        if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return
        setNote('Shortcuts need ⌘ or Ctrl plus a key (Option/Alt combos are reserved for typing)')
        setRecordingId(null)
        return
      }
      const def = SHORTCUT_DEFS.find((d) => d.id === recordingId)
      const next = { ...overrides }
      if (def && normalizeCombo(def.defaultCombo) === combo) delete next[recordingId]
      else next[recordingId] = combo
      persist(next)
      setRecordingId(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, overrides])

  const conflicts = useMemo(() => detectConflicts(overrides), [overrides])
  const groups = useMemo(() => {
    const out = new Map<string, typeof SHORTCUT_DEFS>()
    for (const def of SHORTCUT_DEFS) out.set(def.group, [...(out.get(def.group) ?? []), def])
    return out
  }, [])

  /** Human description of what a conflicted action collides with. */
  const conflictDetail = (id: ShortcutActionId): string => {
    const combo = resolveCombo(id, overrides)
    if (FIXED_COMBOS.has(combo)) return 'collides with the fixed ⌘1–8 tab shortcuts'
    const others = SHORTCUT_DEFS.filter(
      (d) => d.id !== id && resolveCombo(d.id, overrides) === combo
    )
    return others.length > 0 ? `also assigned to ${others.map((d) => d.label).join(', ')}` : ''
  }

  const anyOverrides = Object.keys(overrides).length > 0

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Click Record, then press the new key combination. Esc cancels; Backspace restores the
        default. Changes apply immediately and are saved.
      </div>
      {note && <div className="text-[11px] text-yellow-500">{note}</div>}
      {[...groups.entries()].map(([group, defs]) => (
        <div key={group}>
          <div className="mb-1 text-xs font-medium">{group}</div>
          <div className="space-y-1">
            {defs.map((def) => {
              const combo = resolveCombo(def.id, overrides)
              const conflicted = conflicts.has(def.id)
              const overridden = def.id in overrides
              const recording = recordingId === def.id
              return (
                <div
                  key={def.id}
                  className="flex items-center gap-2 rounded border border-border px-2 py-1.5"
                >
                  <span className="flex-1 text-xs">{def.label}</span>
                  {conflicted && (
                    <span className="text-[10px] text-destructive">{conflictDetail(def.id)}</span>
                  )}
                  <kbd
                    className={cn(
                      'rounded border px-1.5 py-0.5 font-mono text-[11px]',
                      conflicted
                        ? 'border-destructive text-destructive'
                        : 'border-border text-muted-foreground'
                    )}
                  >
                    {recording ? 'Press keys…' : comboLabel(combo, isMac)}
                  </kbd>
                  <Tip
                    content={
                      recording
                        ? 'Press the new combination now — Esc cancels, Backspace resets to default'
                        : `Record a new key combination for “${def.label}”`
                    }
                  >
                    <Button
                      size="sm"
                      variant={recording ? 'default' : 'outline'}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => {
                        setNote(null)
                        setRecordingId(recording ? null : def.id)
                      }}
                    >
                      {recording ? 'Recording…' : 'Record'}
                    </Button>
                  </Tip>
                  <Tip content={`Reset “${def.label}” to its default shortcut`}>
                    <span className="inline-flex">
                      <button
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                        disabled={!overridden}
                        onClick={() => {
                          const next = { ...overrides }
                          delete next[def.id]
                          persist(next)
                        }}
                      >
                        <RotateCcw size={12} />
                      </button>
                    </span>
                  </Tip>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">
          {isMac ? '⌘1–8' : 'Ctrl+1–8'} tab switching is fixed.
        </span>
        <Tip content="Restore all shortcuts to their defaults">
          <span className="inline-flex">
            <Button
              size="sm"
              variant="outline"
              disabled={!anyOverrides}
              onClick={() => persist({})}
            >
              Reset all
            </Button>
          </span>
        </Tip>
      </div>
      {save.error && (
        <div className="text-xs text-destructive selectable">{save.error.message}</div>
      )}
    </div>
  )
}
