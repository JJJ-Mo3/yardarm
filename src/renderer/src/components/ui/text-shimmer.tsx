/**
 * Text with an animated gradient sweep, used for in-progress labels (e.g.
 * tool rows while a tool is running). The gradient uses theme variables so
 * it adapts to light/dark mode; see .text-shimmer in styles/globals.css.
 */
import React from 'react'
import { cn } from '../../lib/utils'

export function TextShimmer({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return <span className={cn('text-shimmer', className)}>{children}</span>
}
