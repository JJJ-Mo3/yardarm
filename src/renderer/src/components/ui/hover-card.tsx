/**
 * Shadcn-style wrapper over Radix HoverCard — hover-triggered preview cards
 * (e.g. sidebar chat row previews). Content renders in a portal so it can
 * escape overflow-hidden containers; style matches popover.tsx.
 */
import * as React from 'react'
import * as HoverCardPrimitive from '@radix-ui/react-hover-card'
import { cn } from '../../lib/utils'

export const HoverCard = HoverCardPrimitive.Root
export const HoverCardTrigger = HoverCardPrimitive.Trigger

export function HoverCardContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>): React.JSX.Element {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-md border border-border bg-background p-3 shadow-md focus:outline-none',
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}
