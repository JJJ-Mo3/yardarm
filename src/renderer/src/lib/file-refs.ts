/**
 * Inline-code file-reference parsing for chat markdown: recognizes spans like
 * `src/main/index.ts:42`, `path/to/file.ts:10-20`, or bare repo-relative
 * paths so /ask citations (and any assistant reply) can deep-link into the
 * Files IDE tab. Deliberately conservative — URLs, timestamps, version
 * numbers, and shell-ish text must not linkify; a span that fails to parse
 * simply renders as plain inline code.
 */

export interface FileRef {
  path: string
  /** 1-based line (the start of the range for `path:start-end` spans). */
  line?: number
}

/** A slash-less name only counts as a file when it has one of these extensions. */
const KNOWN_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'json',
  'jsonc',
  'md',
  'mdx',
  'txt',
  'css',
  'scss',
  'less',
  'html',
  'svg',
  'yml',
  'yaml',
  'toml',
  'ini',
  'env',
  'lock',
  'py',
  'rb',
  'erb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'graphql',
  'proto',
  'vue',
  'svelte',
  'astro',
  'prisma',
  'dockerfile',
  'plist',
  'xml',
  'csv'
])

/** Characters allowed in a repo-relative path segment (posix, no spaces). */
const PATH_CHARS = /^[A-Za-z0-9._@+~/-]+$/

function isPathLike(path: string): boolean {
  if (!path || path.startsWith('-') || path.endsWith('/') || path.includes('//')) return false
  if (!PATH_CHARS.test(path)) return false
  // Must look like a file, not a bare word, number, or version string.
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  if (!path.includes('/') && !KNOWN_EXTENSIONS.has(ext)) return false
  // Version-ish strings (`1.2.3`, `v2.0`) and dotted numbers never linkify.
  if (/^[v~^]?\d+(\.\d+)*$/.test(path)) return false
  // Require at least one letter somewhere — rejects `1/2`-style fractions.
  if (!/[A-Za-z]/.test(path)) return false
  return true
}

/**
 * Parse an inline-code span as a file reference. Accepts `path`,
 * `path:line`, `path:line:col`, and `path:start-end`; returns null for
 * anything that doesn't confidently look like a repo-relative file path.
 */
export function parseFileRef(text: string): FileRef | null {
  const trimmed = text.trim()
  if (!trimmed || /[\s`]/.test(trimmed) || trimmed.includes('://')) return null
  const m = /^(.+?)(?::(\d+)(?:[:\-–](\d+))?)?$/.exec(trimmed)
  if (!m) return null
  let path = m[1]
  if (path.startsWith('./')) path = path.slice(2)
  if (!isPathLike(path)) return null
  const line = m[2] ? parseInt(m[2], 10) : undefined
  if (line !== undefined && line < 1) return null
  return line !== undefined ? { path, line } : { path }
}
