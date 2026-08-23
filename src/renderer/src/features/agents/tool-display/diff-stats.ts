/**
 * Cheap +added/−removed line stats for edit-like tool calls, shown in the
 * compact tool row. These are raw old/new line counts (not a minimal diff)
 * so they stay O(args) and safe against truncated-args stubs and partial
 * JSON: any guard failure returns null and the row simply omits the badge.
 */

export interface DiffStats {
  added: number
  removed: number
}

export function countLines(text: string): number {
  if (text === '') return 0
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++
  }
  return lines
}

export function diffStatsFor(
  toolName: string,
  args: Record<string, unknown> | null
): DiffStats | null {
  if (!args) return null
  switch (toolName) {
    case 'string_replace_lsp': {
      const { old_string: oldStr, new_string: newStr } = args
      if (typeof oldStr !== 'string' || typeof newStr !== 'string') return null
      return { added: countLines(newStr), removed: countLines(oldStr) }
    }
    case 'write_file': {
      const { content } = args
      if (typeof content !== 'string') return null
      return { added: countLines(content), removed: 0 }
    }
    case 'ast_smart_edit': {
      const { pattern, replacement } = args
      if (typeof pattern !== 'string' || typeof replacement !== 'string') return null
      return { added: countLines(replacement), removed: countLines(pattern) }
    }
    default:
      return null
  }
}
