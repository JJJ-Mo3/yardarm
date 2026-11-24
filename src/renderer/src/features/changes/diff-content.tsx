/**
 * Shared unified-diff renderer for the Changes view: working-tree diffs,
 * commit diffs, and checkpoint snapshot compares all feed the same
 * old/new-content shape through @git-diff-view.
 *
 * With the optional `review` prop (working-tree diffs only) the diff becomes
 * reviewable: a "+" on each hovered line opens an inline comment form, draft
 * comments render under the lines they refer to, and each revertable hunk
 * gets a "Revert this change" row under its last changed line.
 *
 * The rows injected into the diff read the live review state from context
 * and the render callbacks handed to the diff view are module-level, so the
 * view never holds a stale closure and doesn't re-render rows needlessly.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { DiffModeEnum, DiffView, SplitSide, type DiffViewProps } from '@git-diff-view/react'
import { generateDiffFile } from '@git-diff-view/file'
import { MessageSquarePlus, Undo2, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'
import { lineLabel, type CommentSide, type LineRange, type ReviewComment } from './review-comments'

export interface DiffData {
  path: string
  oldContent: string
  newContent: string
  binary: boolean
}

/** A hunk that can be reverted on its own (mirrors the main-process HunkInfo). */
export interface RevertableHunk {
  index: number
  hash: string
  header: string
  anchorSide: CommentSide
  anchorLine: number
  added: number
  removed: number
}

export interface DiffReview {
  /** Draft comments on this file. */
  comments: ReviewComment[]
  onAddComment: (range: LineRange, text: string) => void
  onRemoveComment: (id: string) => void
  /** Revertable hunks of this diff (empty hides the action). */
  hunks: RevertableHunk[]
  onRevertHunk: (hunk: RevertableHunk) => void
  revertPending: boolean
  /** One-shot request to open the comment form for a line range (from a text selection). */
  rangeRequest: (LineRange & { nonce: number }) | null
  /** Called once the request's form is open, so it is not replayed on remount. */
  onRangeRequestHandled: () => void
}

/** What hangs under one diff line: its draft comments and/or a hunk's revert row. */
interface LineExtras {
  comments: ReviewComment[]
  hunk: RevertableHunk | null
}

type ReviewDiffProps = DiffViewProps<LineExtras>
type WidgetHook = Parameters<NonNullable<ReviewDiffProps['onCreateUseWidgetHook']>>[0]

/** Live review state for the rows rendered inside the diff view. */
const ReviewContext = createContext<{ review: DiffReview; pending: LineRange | null } | null>(null)

const sideOf = (side: SplitSide): CommentSide => (side === SplitSide.old ? 'old' : 'new')

/**
 * Line range covered by a DOM selection inside a rendered unified diff, read
 * from the line-number cells of the first and last selected rows. Prefers the
 * new side; falls back to the old side when only removed lines are selected.
 * Null when the selection doesn't sit on diff lines.
 */
export function selectionLineRange(range: Range): LineRange | null {
  const rowOf = (container: Node, offset: number, isEnd: boolean): Element | null => {
    let node: Node = container
    // A boundary on an element (e.g. the table body) points between children.
    if (container instanceof Element && container.childNodes.length > 0) {
      const i = isEnd ? Math.max(0, offset - 1) : offset
      node = container.childNodes[Math.min(i, container.childNodes.length - 1)]
    }
    const el = node instanceof Element ? node : node.parentElement
    return el?.closest('tr.diff-line') ?? null
  }
  const first = rowOf(range.startContainer, range.startOffset, false)
  let last = rowOf(range.endContainer, range.endOffset, true)
  if (!first || !last) return null
  if (last !== first) {
    // A selection that ends at the very start of a row selects nothing in it.
    const tail = range.cloneRange()
    tail.setStart(last, 0)
    if (tail.toString() === '' && last.previousElementSibling) last = last.previousElementSibling
  }
  const olds: number[] = []
  const news: number[] = []
  for (let row: Element | null = first; row; row = row.nextElementSibling) {
    const o = Number(row.querySelector('[data-line-old-num]')?.getAttribute('data-line-old-num'))
    const n = Number(row.querySelector('[data-line-new-num]')?.getAttribute('data-line-new-num'))
    if (Number.isInteger(o) && o > 0) olds.push(o)
    if (Number.isInteger(n) && n > 0) news.push(n)
    if (row === last) break
  }
  const side: CommentSide = news.length > 0 ? 'new' : 'old'
  const nums = side === 'new' ? news : olds
  if (nums.length === 0) return null
  return { side, startLine: Math.min(...nums), endLine: Math.max(...nums) }
}

/** Inline form for writing one draft comment, shown under the range's last line. */
function CommentWidget({
  side,
  lineNumber,
  onClose
}: {
  side: CommentSide
  lineNumber: number
  onClose: () => void
}): React.JSX.Element | null {
  const ctx = useContext(ReviewContext)
  const [text, setText] = useState('')
  if (!ctx) return null
  const { pending, review } = ctx
  // The form is anchored on a single line; a pending selection ending on
  // that line widens it to the selected range.
  const range: LineRange =
    pending && pending.side === side && pending.endLine === lineNumber
      ? pending
      : { side, startLine: lineNumber, endLine: lineNumber }
  const submit = (): void => {
    if (!text.trim()) return
    review.onAddComment(range, text.trim())
    onClose()
  }
  return (
    <div className="space-y-1.5 border-y border-border bg-background px-3 py-2 font-sans">
      <div className="select-none text-[11px] text-muted-foreground">
        Comment on {lineLabel(range)}
      </div>
      <Textarea
        autoFocus
        rows={2}
        placeholder="What should change here?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Tip content="Close without adding a comment">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </Tip>
        <Tip content="Add this as a draft review comment (⌘/Ctrl+Enter) — drafts are sent to the agent together">
          <span className="inline-flex">
            <Button size="sm" disabled={!text.trim()} onClick={submit}>
              <MessageSquarePlus size={13} />
              Add comment
            </Button>
          </span>
        </Tip>
      </div>
    </div>
  )
}

/** Draft comments and/or the hunk revert action shown under one diff line. */
function LineExtrasRow({ data }: { data: LineExtras }): React.JSX.Element | null {
  const ctx = useContext(ReviewContext)
  if (!ctx) return null
  const { review } = ctx
  const hunk = data.hunk
  return (
    <div className="font-sans">
      {data.comments.map((c) => (
        <div
          key={c.id}
          className="mx-3 my-1.5 rounded-md border border-border bg-background px-2 py-1.5"
        >
          <div className="flex select-none items-center gap-1.5 text-[10px] text-muted-foreground">
            <MessageSquarePlus size={11} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Draft comment · {lineLabel(c)}</span>
            <Tip content="Remove this draft comment">
              <button
                aria-label="Remove comment"
                onClick={() => review.onRemoveComment(c.id)}
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
              >
                <X size={11} />
              </button>
            </Tip>
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-[11px]">{c.text}</div>
        </div>
      ))}
      {hunk && (
        <div className="flex select-none justify-end border-y border-border/50 bg-muted/30 px-3 py-0.5">
          <Tip
            content={`Discard only this change (+${hunk.added} −${hunk.removed}) from the working tree — the rest of the file is kept`}
          >
            <span className="inline-flex">
              <button
                disabled={review.revertPending}
                onClick={() => review.onRevertHunk(hunk)}
                className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive disabled:cursor-default disabled:opacity-50"
              >
                <Undo2 size={10} />
                Revert this change
              </button>
            </span>
          </Tip>
        </div>
      )}
    </div>
  )
}

const renderWidgetLine: NonNullable<ReviewDiffProps['renderWidgetLine']> = ({
  side,
  lineNumber,
  onClose
}) => (
  <CommentWidget
    key={`${side}:${lineNumber}`}
    side={sideOf(side)}
    lineNumber={lineNumber}
    onClose={onClose}
  />
)

const renderExtendLine: NonNullable<ReviewDiffProps['renderExtendLine']> = ({ data }) => (
  <LineExtrasRow data={data} />
)

export function DiffContent({
  diff,
  isLoading,
  review
}: {
  diff: DiffData | undefined
  isLoading: boolean
  /** Enables line comments and per-hunk revert (working-tree diffs only). */
  review?: DiffReview
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

  // Range the open comment form covers; the form itself is anchored (by the
  // diff view's widget state) on the range's last line.
  const [pending, setPending] = useState<LineRange | null>(null)
  const widgetHook = useRef<WidgetHook | null>(null)
  const onCreateUseWidgetHook = useCallback((hook: WidgetHook) => {
    widgetHook.current = hook
  }, [])
  const onAddWidgetClick = useCallback((lineNumber: number, side: SplitSide) => {
    setPending({ side: sideOf(side), startLine: lineNumber, endLine: lineNumber })
  }, [])

  const rangeRequest = review?.rangeRequest ?? null
  const onRangeRequestHandled = review?.onRangeRequestHandled
  useEffect(() => {
    if (!rangeRequest) return
    setPending({
      side: rangeRequest.side,
      startLine: rangeRequest.startLine,
      endLine: rangeRequest.endLine
    })
    widgetHook.current?.getReadonlyState().setWidget({
      side: rangeRequest.side === 'old' ? SplitSide.old : SplitSide.new,
      lineNumber: rangeRequest.endLine
    })
    onRangeRequestHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per request
  }, [rangeRequest])

  const comments = review?.comments
  const hunks = review?.hunks
  const extendData = useMemo(() => {
    const data: Record<'oldFile' | 'newFile', Record<string, { data: LineExtras }>> = {
      oldFile: {},
      newFile: {}
    }
    const slot = (side: CommentSide, line: number): LineExtras => {
      const file = side === 'old' ? data.oldFile : data.newFile
      file[line] ??= { data: { comments: [], hunk: null } }
      return file[line].data
    }
    for (const c of comments ?? []) slot(c.side, c.endLine).comments.push(c)
    for (const h of hunks ?? []) slot(h.anchorSide, h.anchorLine).hunk = h
    return data
  }, [comments, hunks])

  const context = useMemo(() => (review ? { review, pending } : null), [review, pending])

  if (isLoading) {
    return <div className="p-4 text-xs text-muted-foreground">Loading diff…</div>
  }
  if (diff?.binary) {
    return <div className="p-4 text-xs text-muted-foreground">Binary file</div>
  }
  if (!diffFile) {
    return <div className="p-4 text-xs text-muted-foreground">No diff available</div>
  }
  if (!context) {
    return (
      <div className="selectable text-xs">
        <DiffView diffFile={diffFile} diffViewMode={DiffModeEnum.Unified} diffViewFontSize={12} />
      </div>
    )
  }
  return (
    <ReviewContext.Provider value={context}>
      <div className="selectable text-xs">
        <DiffView<LineExtras>
          diffFile={diffFile}
          diffViewMode={DiffModeEnum.Unified}
          diffViewFontSize={12}
          diffViewAddWidget
          onCreateUseWidgetHook={onCreateUseWidgetHook}
          onAddWidgetClick={onAddWidgetClick}
          renderWidgetLine={renderWidgetLine}
          extendData={extendData}
          renderExtendLine={renderExtendLine}
        />
      </div>
    </ReviewContext.Provider>
  )
}
