/**
 * Chat markdown renderer (GFM). ```mermaid fences render as diagrams via
 * MermaidBlock; the pre override unwraps them so the diagram isn't boxed in
 * the code-block chrome.
 */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from './MermaidBlock'

function isMermaidCode(node: React.ReactNode): node is React.ReactElement {
  if (!React.isValidElement(node)) return false
  const cls = (node.props as { className?: unknown }).className
  return typeof cls === 'string' && cls.includes('language-mermaid')
}

function Pre({ children, ...props }: React.ComponentProps<'pre'>): React.JSX.Element {
  const items = React.Children.toArray(children)
  if (items.length === 1 && isMermaidCode(items[0])) return <>{children}</>
  return <pre {...props}>{children}</pre>
}

function Code({ className, children, ...props }: React.ComponentProps<'code'>): React.JSX.Element {
  if (className?.includes('language-mermaid')) {
    return <MermaidBlock code={typeof children === 'string' ? children : String(children ?? '')} />
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  )
}

export const Markdown = React.memo(function Markdown({
  text
}: {
  text: string
}): React.JSX.Element {
  return (
    <div className="markdown text-[13px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: Pre, code: Code }}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
