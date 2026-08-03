/**
 * Composer attachment classification and prompt inlining. Providers only
 * accept images and PDFs as native file parts (text/plain is Anthropic-only
 * and text/markdown throws everywhere), so text-like files are inlined into
 * the prompt content as <attached-file> blocks instead, with a clean
 * displayText for the transcript.
 */

export interface ComposerAttachment {
  data: string
  mediaType: string
  filename?: string
}

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'unsupported'

/** Text attachments above this size are rejected — inlining them would blow the context. */
export const MAX_TEXT_ATTACHMENT_BYTES = 512 * 1024

/** Extensions treated as text when the browser reports no useful MIME type. */
export const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'text',
  'log',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'xml',
  'html',
  'htm',
  'svg',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'java',
  'kt',
  'swift',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'vue',
  'svelte',
  'diff',
  'patch',
  'env',
  'gitignore',
  'dockerfile',
  'makefile'
])

const APP_TEXT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/typescript',
  'application/x-sh',
  'application/toml'
])

/**
 * Route an attachment: images and PDFs go through as native file parts,
 * text-like files get inlined, anything else is rejected. SVG is classified
 * as text before the image check — Anthropic's image block only accepts
 * jpeg/png/gif/webp.
 */
export function classifyAttachment(mediaType: string, filename?: string): AttachmentKind {
  if (mediaType === 'image/svg+xml') return 'text'
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType === 'application/pdf') return 'pdf'
  if (mediaType.startsWith('text/') || APP_TEXT_TYPES.has(mediaType)) return 'text'
  const name = (filename ?? '').toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  if (ext && TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'unsupported'
}

/** The file-picker accept list matching what classifyAttachment allows. */
export const ATTACHMENT_ACCEPT = ['image/*', 'application/pdf', 'text/*']
  .concat([...TEXT_EXTENSIONS].map((ext) => `.${ext}`))
  .join(',')

/** Decode a base64 string as UTF-8 text. */
export function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/**
 * Inline text attachments into the prompt. `content` is what the agent sees;
 * `displayText` is the clean transcript bubble (message + attachment note,
 * mirroring the session manager's "[N files attached]" style). The tag
 * wrapper avoids collisions with ``` fences inside the files.
 */
export function buildAttachmentPrompt(
  content: string,
  texts: ComposerAttachment[]
): { content: string; displayText: string } {
  const blocks = texts.map(
    (t) =>
      `<attached-file name="${t.filename ?? 'file'}">\n${decodeBase64Utf8(t.data)}\n</attached-file>`
  )
  const names = texts.map((t) => t.filename ?? 'text file')
  return {
    content: `${content}\n\n${blocks.join('\n\n')}`,
    displayText: `${content}\n\n[attached: ${names.join(', ')}]`
  }
}
