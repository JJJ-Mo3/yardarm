import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export const Markdown = React.memo(function Markdown({
  text
}: {
  text: string
}): React.JSX.Element {
  return (
    <div className="markdown text-[13px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
})
