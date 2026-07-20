import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-72 rounded-md border border-border bg-background px-2 py-1 text-[11px] leading-4 text-foreground shadow-md',
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

/**
 * Convenience wrapper: `<Tip content="…"><button/></Tip>`. The child is used
 * as the trigger (asChild). Renders the child unwrapped when content is empty.
 */
export function Tip({
  content,
  side,
  align,
  children
}: {
  content?: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  children: React.ReactElement
}): React.JSX.Element {
  if (!content) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
