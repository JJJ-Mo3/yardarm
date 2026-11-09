/**
 * Chat markdown renderer (GFM). ```mermaid fences render as diagrams via
 * MermaidBlock; the pre override unwraps them so the diagram isn't boxed in
 * the code-block chrome. With linkifyFileRefs on (assistant replies), inline
 * code spans that parse as repo-relative file references (`path:line`)
 * render as FileRefLink and deep-link into the Files IDE tab.
 */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseFileRef } from '../../lib/file-refs'
import { MermaidBlock } from './MermaidBlock'
import { FileRefLink } from './FileRefLink'

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

/** Code override that additionally linkifies single-line inline file refs. */
function CodeWithFileRefs({
  className,
  children,
  ...props
}: React.ComponentProps<'code'>): React.JSX.Element {
  if (!className && typeof children === 'string' && !children.includes('\n')) {
    const ref = parseFileRef(children)
    if (ref) return <FileRefLink fileRef={ref} label={children} />
  }
  return (
    <Code className={className} {...props}>
      {children}
    </Code>
  )
}

export const Markdown = React.memo(function Markdown({
  text,
  linkifyFileRefs = false
}: {
  text: string
  linkifyFileRefs?: boolean
}): React.JSX.Element {
  return (
    <div className="markdown text-[13px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ pre: Pre, code: linkifyFileRefs ? CodeWithFileRefs : Code }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
