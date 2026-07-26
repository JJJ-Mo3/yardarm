/**
 * Draggable vertical divider between the primary chat pane and the split
 * pane. Pointer-capture based; reports the primary pane's width fraction
 * (clamped 0.25–0.75) relative to the given container.
 */
import React from 'react'

export function SplitDivider({
  containerRef,
  onRatio
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  onRatio: (ratio: number) => void
}): React.JSX.Element {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const ratio = (e.clientX - rect.left) / rect.width
    onRatio(Math.min(0.75, Math.max(0.25, ratio)))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent-foreground/30 active:bg-accent-foreground/40"
    />
  )
}
