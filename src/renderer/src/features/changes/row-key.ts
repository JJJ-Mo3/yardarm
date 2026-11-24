/**
 * Keyboard activation for clickable `<div role="button">` rows: Enter/Space
 * runs the row's action. Key events bubbling up from nested controls (row
 * action buttons, inline inputs) are ignored so those keep working.
 */
import type React from 'react'

export function rowKey(run: () => void): (e: React.KeyboardEvent) => void {
  return (e) => {
    if (e.target !== e.currentTarget) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    run()
  }
}
