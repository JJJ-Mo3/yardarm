/**
 * Shared model dropdown for settings/onboarding. Lists only usable models
 * (hasApiKey) instead of hundreds of disabled "(no key)" entries; if the
 * current value is no longer usable it stays visible as a single disabled
 * "(no key)" option so existing selections aren't silently lost.
 */
import React from 'react'

export function ModelSelect({
  value,
  onChange,
  models,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  models: Array<{ id: string; hasApiKey: boolean }>
  placeholder: string
}): React.JSX.Element {
  const usable = models.filter((m) => m.hasApiKey)
  const currentUnusable = value && !usable.some((m) => m.id === value) ? value : null
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[11px]"
    >
      <option value="">{placeholder}</option>
      {usable.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id}
        </option>
      ))}
      {currentUnusable && (
        <option value={currentUnusable} disabled>
          {currentUnusable} (no key)
        </option>
      )}
    </select>
  )
}
