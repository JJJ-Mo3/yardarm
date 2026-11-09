/**
 * Clickable inline-code file reference: clicking opens the file (at the
 * cited line, when present) in the Files IDE tab via fileOpenRequestAtom.
 * Rendered by Markdown when linkifyFileRefs is on and an inline code span
 * parses as a repo-relative path (see lib/file-refs.ts).
 */
import React from 'react'
import { useSetAtom } from 'jotai'
import { fileOpenRequestAtom, mainTabAtom } from '../../lib/atoms'
import { Tip } from '../../components/ui/tooltip'
import type { FileRef } from '../../lib/file-refs'

export function FileRefLink({
  fileRef,
  label
}: {
  fileRef: FileRef
  label: string
}): React.JSX.Element {
  const setFileOpenRequest = useSetAtom(fileOpenRequestAtom)
  const setTab = useSetAtom(mainTabAtom)
  return (
    <Tip
      content={`Open ${fileRef.path}${fileRef.line ? ` at line ${fileRef.line}` : ''} in the Files tab`}
    >
      <button
        onClick={() => {
          setFileOpenRequest({ path: fileRef.path, line: fileRef.line })
          setTab('files')
        }}
        className="cursor-pointer align-baseline"
      >
        <code className="underline decoration-dotted underline-offset-2 hover:decoration-solid">
          {label}
        </code>
      </button>
    </Tip>
  )
}
