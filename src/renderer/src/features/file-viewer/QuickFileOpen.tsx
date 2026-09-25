/**
 * Cmd+O quick file open: fuzzy-searches every file in the active worktree
 * (git-tracked + untracked, .gitignore respected) and opens the selection in
 * the IDE tab via fileOpenRequestAtom. The full path list is fetched once per
 * open; ranking happens client-side in lib/fuzzy.ts.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useAtom, useSetAtom } from 'jotai'
import { FileCode2, Search } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { fileOpenRequestAtom, mainTabAtom, quickOpenAtom } from '../../lib/atoms'
import { fuzzyFilter } from '../../lib/fuzzy'
import { cn } from '../../lib/utils'

const MAX_RESULTS = 50

export function QuickFileOpen({ root }: { root: string | null }): React.JSX.Element {
  const [open, setOpen] = useAtom(quickOpenAtom)
  const setTab = useSetAtom(mainTabAtom)
  const setFileOpenRequest = useSetAtom(fileOpenRequestAtom)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const files = trpc.files.list.useQuery(
    { root: root ?? '' },
    { enabled: open && !!root, staleTime: 10_000 }
  )

  // Fresh state on every open.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const filtered = useMemo(
    () => fuzzyFilter(files.data ?? [], query, MAX_RESULTS),
    [files.data, query]
  )
  const clamped = Math.min(active, Math.max(0, filtered.length - 1))

  const openFile = (p: string): void => {
    setOpen(false)
    setFileOpenRequest(p)
    setTab('files')
  }

  // Keep the active row visible while arrowing through the list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${clamped}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [clamped])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[18%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-background shadow-xl focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Open file</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              placeholder="Open file by name…"
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (filtered.length === 0) return
                  const dir = e.key === 'ArrowDown' ? 1 : -1
                  setActive((clamped + dir + filtered.length) % filtered.length)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const p = filtered[clamped]
                  if (p) openFile(p)
                }
              }}
              className="h-10 w-full bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label="Files"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {!root && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                Open a project to search its files
              </div>
            )}
            {root && filtered.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                {files.isLoading ? 'Loading files…' : 'No matches'}
              </div>
            )}
            {filtered.map((p, i) => {
              const slash = p.lastIndexOf('/')
              const base = slash >= 0 ? p.slice(slash + 1) : p
              const dir = slash >= 0 ? p.slice(0, slash) : ''
              return (
                <div
                  key={p}
                  role="option"
                  aria-selected={i === clamped}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => openFile(p)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px]',
                    i === clamped && 'bg-accent'
                  )}
                >
                  <FileCode2 size={13} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 shrink-0 truncate">{base}</span>
                  {dir && (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {dir}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
