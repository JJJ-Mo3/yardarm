/**
 * Read-only alternate views for the IDE tab: image preview (dimensions + file
 * size; always an `<img>` with a `data:` URL, so SVG is never inlined into the
 * DOM and cannot run script), rendered Markdown (the chat Markdown component —
 * raw HTML stays disabled), a capped CSV/TSV table, and the Edit/Preview or
 * Text/Table toggle that switches between the Monaco editor and these.
 */
import React, { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { formatByteSize, MAX_IMAGE_PREVIEW_BYTES } from '@shared/image-preview'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { Markdown } from '../agents/Markdown'
import { parseDelimited, type AltViewKind } from './delimited-parse'

/** Rendering more Markdown than this at once would stall the UI. */
const MARKDOWN_PREVIEW_MAX_CHARS = 500_000

function CenteredNote({
  children,
  destructive = false
}: {
  children: React.ReactNode
  destructive?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center px-6 text-center text-xs',
        destructive ? 'selectable text-destructive' : 'text-muted-foreground'
      )}
    >
      {children}
    </div>
  )
}

/** An image scaled to fit, with a "W × H px · size" caption. */
export function ImageView({
  src,
  sizeBytes,
  alt,
  actions
}: {
  src: string
  sizeBytes: number
  alt: string
  actions?: React.ReactNode
}): React.JSX.Element {
  // Keyed by src so a reloaded image never shows the previous one's numbers.
  const [dims, setDims] = useState<{ src: string; w: number; h: number } | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const size = dims?.src === src ? dims : null
  const failed = failedSrc === src

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
        {failed ? (
          <span className="text-xs text-muted-foreground">This image could not be displayed</span>
        ) : (
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="max-h-full max-w-full object-contain"
            onLoad={(e) =>
              setDims({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            onError={() => setFailedSrc(src)}
          />
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border px-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {size && size.w > 0 ? `${size.w} × ${size.h} px` : failed ? 'Unknown dimensions' : '…'}
        </span>
        <span>·</span>
        <span className="tabular-nums">{formatByteSize(sizeBytes)}</span>
        <div className="flex-1" />
        {actions}
      </div>
    </div>
  )
}

/** Preview of an image file on disk (binary images, and SVGs too large to edit). */
export function DiskImagePreview({
  root,
  path
}: {
  root: string
  path: string
}): React.JSX.Element {
  // Not cached: previews can be megabytes of base64, and the file may change.
  const image = trpc.files.readImage.useQuery(
    { root, path },
    { staleTime: 0, gcTime: 0, refetchOnMount: 'always', retry: false }
  )
  const reload = (
    <Tip content="Reload this image from disk">
      <span className="inline-flex">
        <Button
          aria-label="Reload image"
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          disabled={image.isFetching}
          onClick={() => void image.refetch()}
        >
          <RefreshCw size={11} className={cn(image.isFetching && 'animate-spin')} />
        </Button>
      </span>
    </Tip>
  )

  if (image.error) {
    return <CenteredNote destructive>Could not load the image: {image.error.message}</CenteredNote>
  }
  const data = image.data
  if (!data) return <CenteredNote>Loading image…</CenteredNote>
  if (data.tooLarge) {
    return (
      <CenteredNote>
        Image too large to preview ({formatByteSize(data.size)} — the limit is{' '}
        {formatByteSize(MAX_IMAGE_PREVIEW_BYTES)})
      </CenteredNote>
    )
  }
  if (data.invalid || !data.dataUrl) {
    return (
      <CenteredNote>
        This file has an image extension but does not contain {data.mime} data
      </CenteredNote>
    )
  }
  return <ImageView src={data.dataUrl} sizeBytes={data.size} alt={path} actions={reload} />
}

/** Preview of the SVG text currently in the editor buffer (unsaved edits included). */
export function SvgTextPreview({ text, path }: { text: string; path: string }): React.JSX.Element {
  const { src, bytes } = useMemo(
    () => ({
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`,
      bytes: new TextEncoder().encode(text).length
    }),
    [text]
  )
  return <ImageView src={src} sizeBytes={bytes} alt={path} />
}

/** Rendered Markdown of the editor buffer. */
export function MarkdownPreview({ text }: { text: string }): React.JSX.Element {
  const clipped = text.length > MARKDOWN_PREVIEW_MAX_CHARS
  const shown = clipped ? text.slice(0, MARKDOWN_PREVIEW_MAX_CHARS) : text
  return (
    <div className="selectable h-full overflow-y-auto px-6 py-4">
      {clipped && (
        <div className="mb-3 text-[11px] text-muted-foreground">
          Showing the first {MARKDOWN_PREVIEW_MAX_CHARS.toLocaleString()} characters of this file.
        </div>
      )}
      {shown.trim() ? (
        <Markdown text={shown} />
      ) : (
        <div className="text-xs text-muted-foreground">This file is empty</div>
      )}
    </div>
  )
}

/** Scrollable table of the first rows of a CSV/TSV buffer; the first row is the header. */
export function DelimitedTableView({
  text,
  delimiter
}: {
  text: string
  delimiter: string
}): React.JSX.Element {
  const table = useMemo(() => parseDelimited(text, delimiter), [text, delimiter])
  if (table.rows.length === 0) return <CenteredNote>No rows to show</CenteredNote>

  const [header, ...body] = table.rows
  const columns = Array.from({ length: table.columnCount }, (_, i) => i)
  const notes: string[] = []
  if (table.truncatedRows) notes.push(`Showing first ${table.rows.length} rows`)
  if (table.truncatedColumns) notes.push(`showing first ${table.columnCount} columns`)
  const note = notes.join(' · ')

  return (
    <div className="flex h-full flex-col">
      <div className="selectable min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className="border-b border-r border-border px-2 py-1 text-right font-normal text-muted-foreground">
                #
              </th>
              {columns.map((c) => (
                <th
                  key={c}
                  className="max-w-80 truncate whitespace-nowrap border-b border-r border-border px-2 py-1 text-left font-medium"
                  title={header[c] ?? ''}
                >
                  {header[c] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="hover:bg-accent/40">
                <td className="border-b border-r border-border px-2 py-0.5 text-right tabular-nums text-muted-foreground">
                  {r + 1}
                </td>
                {columns.map((c) => (
                  <td
                    key={c}
                    className="max-w-80 truncate whitespace-nowrap border-b border-r border-border px-2 py-0.5"
                    title={row[c] ?? ''}
                  >
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex h-7 shrink-0 items-center border-t border-border px-3 text-[11px] text-muted-foreground">
        {note
          ? `${note.charAt(0).toUpperCase()}${note.slice(1)} — switch to Text for the whole file`
          : `${body.length} ${body.length === 1 ? 'row' : 'rows'} · ${table.columnCount} ${table.columnCount === 1 ? 'column' : 'columns'}`}
      </div>
    </div>
  )
}

const TOGGLE_COPY: Record<
  AltViewKind,
  { editor: string; alt: string; editorTip: string; altTip: string }
> = {
  markdown: {
    editor: 'Edit',
    alt: 'Preview',
    editorTip: 'Edit the Markdown source',
    altTip: 'Show the rendered Markdown, including unsaved edits'
  },
  image: {
    editor: 'Edit',
    alt: 'Preview',
    editorTip: 'Edit the SVG source',
    altTip: 'Show the SVG as an image, including unsaved edits'
  },
  table: {
    editor: 'Text',
    alt: 'Table',
    editorTip: 'Edit the raw text',
    altTip: 'Show the first rows as a table, including unsaved edits'
  }
}

/** Two-button switch between the editor and a file's alternate view. */
export function ViewToggle({
  kind,
  altOn,
  onChange
}: {
  kind: AltViewKind
  altOn: boolean
  onChange: (altOn: boolean) => void
}): React.JSX.Element {
  const copy = TOGGLE_COPY[kind]
  const cls = (active: boolean): string =>
    cn(
      'cursor-pointer rounded px-1.5 py-0.5 text-[11px]',
      active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
    )
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded border border-border p-0.5">
      <Tip content={copy.editorTip}>
        <button aria-pressed={!altOn} className={cls(!altOn)} onClick={() => onChange(false)}>
          {copy.editor}
        </button>
      </Tip>
      <Tip content={copy.altTip}>
        <button aria-pressed={altOn} className={cls(altOn)} onClick={() => onChange(true)}>
          {copy.alt}
        </button>
      </Tip>
    </div>
  )
}
