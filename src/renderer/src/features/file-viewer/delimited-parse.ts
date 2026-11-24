/**
 * Pure helpers for the IDE tab's alternate file views: which alternate view a
 * path offers (Markdown preview, CSV/TSV table, SVG image preview) and a
 * small RFC 4180-style delimited-text parser for the table view — quoted
 * fields, doubled quotes, embedded delimiters and newlines, CRLF/CR/LF row
 * ends, a leading BOM — that stops at a row cap and trims at a column cap so
 * a huge file can never produce a huge table.
 */

export type AltViewKind = 'markdown' | 'table' | 'image'

/** The alternate (non-editor) view offered for a text file, by extension. */
export function altViewKindFor(filePath: string): AltViewKind | null {
  const name = filePath.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown'
  if (ext === 'csv' || ext === 'tsv') return 'table'
  if (ext === 'svg') return 'image'
  return null
}

/** Field delimiter for a delimited-text path: tab for .tsv, comma otherwise. */
export function delimiterFor(filePath: string): ',' | '\t' {
  return filePath.toLowerCase().endsWith('.tsv') ? '\t' : ','
}

export const TABLE_MAX_ROWS = 500
export const TABLE_MAX_COLUMNS = 50

export interface DelimitedTable {
  /** Parsed rows (the first is conventionally the header), at most maxRows. */
  rows: string[][]
  /** Widest kept row, after the column cap. */
  columnCount: number
  /** More rows existed past the cap. */
  truncatedRows: boolean
  /** At least one row had more fields than the column cap. */
  truncatedColumns: boolean
}

/**
 * Parse delimited text into rows of fields. Lenient where real files are
 * sloppy: a quote inside an unquoted field is literal, text after a closing
 * quote is appended, and an unterminated quote runs to the end of input.
 */
export function parseDelimited(
  text: string,
  delimiter: string = ',',
  maxRows: number = TABLE_MAX_ROWS,
  maxColumns: number = TABLE_MAX_COLUMNS
): DelimitedTable {
  const rows: string[][] = []
  let truncatedRows = false
  let truncatedColumns = false
  let columnCount = 0

  let row: string[] = []
  let field = ''
  let inQuotes = false
  // True once the current row has any content (a field char, quote or delimiter).
  let rowStarted = false
  let fieldQuoted = false

  const endField = (): void => {
    if (row.length < maxColumns) row.push(field)
    else truncatedColumns = true
    field = ''
    fieldQuoted = false
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    if (row.length > columnCount) columnCount = row.length
    row = []
    rowStarted = false
  }

  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    // Blank lines carry no row.
    if ((ch === '\n' || ch === '\r') && !rowStarted) continue
    if (rows.length >= maxRows) {
      // Real content past the cap means the table is truncated.
      truncatedRows = true
      break
    }
    if (ch === '"' && field === '' && !fieldQuoted) {
      inQuotes = true
      fieldQuoted = true
      rowStarted = true
    } else if (ch === delimiter) {
      endField()
      rowStarted = true
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else {
      field += ch
      rowStarted = true
    }
  }
  // Final row without a trailing newline.
  if (!truncatedRows && (rowStarted || field !== '')) endRow()

  return { rows, columnCount, truncatedRows, truncatedColumns }
}
