/**
 * Shared unified-diff renderer for the Changes view: working-tree diffs,
 * commit diffs, and checkpoint snapshot compares all feed the same
 * old/new-content shape through @git-diff-view.
 */
import React, { useMemo } from 'react'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import { generateDiffFile } from '@git-diff-view/file'

export interface DiffData {
  path: string
  oldContent: string
  newContent: string
  binary: boolean
}

export function DiffContent({
  diff,
  isLoading
}: {
  diff: DiffData | undefined
  isLoading: boolean
}): React.JSX.Element {
  const diffFile = useMemo(() => {
    if (!diff || diff.binary) return null
    try {
      const file = generateDiffFile(diff.path, diff.oldContent, diff.path, diff.newContent, '', '')
      file.initRaw()
      return file
    } catch (err) {
      console.error('diff generation failed', err)
      return null
    }
  }, [diff])

  if (isLoading) {
    return <div className="p-4 text-xs text-muted-foreground">Loading diff…</div>
  }
  if (diff?.binary) {
    return <div className="p-4 text-xs text-muted-foreground">Binary file</div>
  }
  if (!diffFile) {
    return <div className="p-4 text-xs text-muted-foreground">No diff available</div>
  }
  return (
    <div className="selectable text-xs">
      <DiffView diffFile={diffFile} diffViewMode={DiffModeEnum.Unified} diffViewFontSize={12} />
    </div>
  )
}
