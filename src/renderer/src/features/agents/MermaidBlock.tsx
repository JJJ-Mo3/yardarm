/**
 * Renders ```mermaid code blocks as diagrams. Mermaid is lazy-loaded on first
 * use, re-renders are debounced 300ms so streaming (incomplete) sources don't
 * flash errors, and invalid syntax falls back to the plain code block.
 */
import React, { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { themeAtom } from '../../lib/atoms'

type MermaidApi = typeof import('mermaid').default

let mermaidPromise: Promise<MermaidApi> | null = null
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((m) => m.default)
  return mermaidPromise
}

let renderSeq = 0

export function MermaidBlock({ code }: { code: string }): React.JSX.Element {
  const theme = useAtomValue(themeAtom)
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const source = code.trim()
    if (!source) {
      setSvg(null)
      return undefined
    }
    // Debounce so a block still streaming in doesn't render partial syntax.
    const id = `yardarm-mermaid-${++renderSeq}`
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid()
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default'
        })
        const result = await mermaid.render(id, source)
        if (!cancelled) setSvg(result.svg)
      } catch {
        // Invalid or incomplete source — fall back to the plain code block.
        document.getElementById(`d${id}`)?.remove()
        if (!cancelled) setSvg(null)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, dark])

  if (svg) {
    return (
      <div
        className="my-2 overflow-x-auto rounded-lg border border-border bg-card p-2"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }
  return (
    <pre>
      <code className="language-mermaid">{code}</code>
    </pre>
  )
}
