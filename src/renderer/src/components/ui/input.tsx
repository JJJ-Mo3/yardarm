import * as React from 'react'
import { cn } from '../../lib/utils'

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-8 w-full rounded-md border border-border bg-background px-2.5 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'
