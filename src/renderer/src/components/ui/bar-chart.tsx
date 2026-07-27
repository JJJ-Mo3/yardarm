/**
 * Dependency-free bar chart for the Analytics tab: one div bar per datum,
 * scaled against the max value. Bars are non-interactive; each carries a
 * native title tooltip with the label and formatted value.
 */
import React from 'react'
import { cn } from '../../lib/utils'

export interface BarDatum {
  label: string
  value: number
}

export function BarChart({
  data,
  height = 128,
  className
}: {
  data: BarDatum[]
  height?: number
  className?: string
}): React.JSX.Element {
  const max = Math.max(0, ...data.map((d) => d.value))
  if (data.length === 0 || max === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground',
          className
        )}
        style={{ height }}
      >
        No data for this period
      </div>
    )
  }
  return (
    <div className={cn('flex items-end gap-px', className)} style={{ height }}>
      {data.map((d, i) => (
        <div
          key={i}
          title={`${d.label}: ${Intl.NumberFormat().format(d.value)}`}
          className="min-w-1 flex-1 rounded-t-sm bg-primary/60 hover:bg-primary"
          style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}
