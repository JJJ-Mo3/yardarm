/**
 * Floating in-chat search overlay (Cmd+F while the Chat tab is visible).
 * Highlights matches in the transcript via the CSS Custom Highlight API —
 * no DOM mutation, so React-managed markdown is never touched — with a
 * match counter and Enter / Shift+Enter navigation.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Tip } from '../../components/ui/tooltip'

const HIGHLIGHT_ALL = 'cz-search'
const HIGHLIGHT_ACTIVE = 'cz-search-active'

/** Case-insensitive plain-text matches across every text node under root. */
function collectRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? ''
    const lower = text.toLowerCase()
    let i = lower.indexOf(needle)
    while (i !== -1) {
      const range = new Range()
      range.setStart(node, i)
      range.setEnd(node, i + needle.length)
      ranges.push(range)
      i = lower.indexOf(needle, i + needle.length)
    }
  }
  return ranges
}

function clearHighlights(): void {
  CSS.highlights.delete(HIGHLIGHT_ALL)
  CSS.highlights.delete(HIGHLIGHT_ACTIVE)
}

export function ChatSearchBar({
  containerRef,
  refreshKey,
  focusSeq,
  onClose
}: {
  /** The transcript scroll container to search within. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Changes when transcript content changes so highlights are recomputed. */
  refreshKey: unknown
  /** Bumped by ChatView when Cmd+F is pressed while already open. */
  focusSeq: number
  onClose: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [total, setTotal] = useState(0)
  const [active, setActive] = useState(0)
  const rangesRef = useRef<Range[]>([])
  // Scroll only on user-initiated navigation/query edits, not on streaming
  // refreshes — a background stream must not yank the viewport around.
  const scrollPending = useRef(false)

  useEffect(() => {
    inputRef.current?.select()
  }, [focusSeq])

  // Recompute matches (150ms debounce) when the query or transcript changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      const root = containerRef.current
      if (!root || !query) {
        rangesRef.current = []
        clearHighlights()
        setTotal(0)
        setActive(0)
        return
      }
      const ranges = collectRanges(root, query)
      rangesRef.current = ranges
      CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges))
      setTotal(ranges.length)
      setActive((a) => (ranges.length === 0 ? 0 : Math.min(a, ranges.length - 1)))
    }, 150)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, refreshKey])

  // Mark + optionally scroll to the active match.
  useEffect(() => {
    const range = rangesRef.current[active]
    if (!range) {
      CSS.highlights.delete(HIGHLIGHT_ACTIVE)
      return
    }
    CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(range))
    if (scrollPending.current) {
      scrollPending.current = false
      const el =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement
      el?.scrollIntoView({ block: 'center' })
    }
  }, [active, total])

  useEffect(() => clearHighlights, [])

  const step = (dir: 1 | -1): void => {
    if (rangesRef.current.length === 0) return
    scrollPending.current = true
    setActive((a) => (a + dir + rangesRef.current.length) % rangesRef.current.length)
  }

  return (
    <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1 shadow-lg">
      <input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder="Find in chat…"
        onChange={(e) => {
          scrollPending.current = true
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            if (e.shiftKey) step(-1)
            else step(1)
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
        className="w-44 bg-transparent text-[12px] focus:outline-none placeholder:text-muted-foreground"
      />
      <span className="min-w-8 text-right text-[10px] tabular-nums text-muted-foreground">
        {total === 0 ? (query ? '0/0' : '') : `${active + 1}/${total}`}
      </span>
      <Tip content="Previous match (Shift+Enter)">
        <button
          onClick={() => step(-1)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ChevronUp size={13} />
        </button>
      </Tip>
      <Tip content="Next match (Enter)">
        <button
          onClick={() => step(1)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ChevronDown size={13} />
        </button>
      </Tip>
      <Tip content="Close search (Esc)">
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <X size={13} />
        </button>
      </Tip>
    </div>
  )
}
