import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../../lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

/**
 * Anchor a popover's content to an element rendered elsewhere (e.g. a shared
 * header "⋯" button) without rendering a trigger of its own. Renders nothing.
 */
export function PopoverVirtualAnchor({
  elementRef
}: {
  elementRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  return (
    <PopoverPrimitive.Anchor
      virtualRef={
        // Radix types virtualRef against its internal Measurable shape; a live
        // element ref satisfies it at runtime (getBoundingClientRect).
        elementRef as unknown as React.ComponentProps<typeof PopoverPrimitive.Anchor>['virtualRef']
      }
    />
  )
}

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-64 rounded-md border border-border bg-background p-3 shadow-md focus:outline-none',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
