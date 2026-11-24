/**
 * In-app confirmation dialog replacing window.confirm (which blocks the
 * renderer and looks foreign in an Electron app). Mount <ConfirmProvider>
 * once at the root; call `const confirm = useConfirm()` then
 * `if (await confirm({ title: '…' }))` anywhere below it.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Tip } from './ui/tooltip'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as destructive (default true — most confirms are deletes). */
  destructive?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false))

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext)
}

export function ConfirmProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [pending, setPending] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      // Settle any dialog we're replacing as cancelled.
      resolver.current?.(false)
      resolver.current = resolve
      setPending(opts)
    })
  }, [])

  const settle = (ok: boolean): void => {
    resolver.current?.(ok)
    resolver.current = null
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && settle(false)}>
        {pending && (
          <DialogContent className="max-w-sm">
            <DialogTitle>{pending.title}</DialogTitle>
            {pending.description && (
              <DialogDescription className="mb-3 whitespace-pre-wrap selectable">
                {pending.description}
              </DialogDescription>
            )}
            <div className="flex justify-end gap-2 mt-2">
              {/* Destructive confirms focus Cancel so a stray Enter never deletes. */}
              <Tip content="Close without doing anything">
                <Button
                  autoFocus={pending.destructive ?? true}
                  variant="ghost"
                  size="sm"
                  onClick={() => settle(false)}
                >
                  {pending.cancelLabel ?? 'Cancel'}
                </Button>
              </Tip>
              <Tip content="Go ahead with this action">
                <Button
                  autoFocus={!(pending.destructive ?? true)}
                  size="sm"
                  variant={(pending.destructive ?? true) ? 'destructive' : 'default'}
                  onClick={() => settle(true)}
                >
                  {pending.confirmLabel ?? 'Confirm'}
                </Button>
              </Tip>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  )
}
