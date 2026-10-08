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
  'makefile',
  // Bare filenames (no extension) that resolve to themselves in classifyAttachment.
  'gemfile',
  'rakefile',
  'procfile',
  'brewfile',
  'caddyfile',
  'jenkinsfile',
  'vagrantfile',
  'justfile',
  'tiltfile',
  'license',
  'readme',
  'changelog',
  'codeowners',
  'notice',
  'authors',
  // Dotfiles (`.npmrc` → suffix `npmrc` via the lastIndexOf('.') slice).
  'npmrc',
  'nvmrc',
  'editorconfig',
  'gitattributes',
  'gitmodules',
  'dockerignore',
  'eslintignore',
  'prettierignore',
  'prettierrc',
  'bashrc',
  'zshrc',
  // More language / config extensions.
  'lua',
  'pl',
  'r',
  'scala',
  'dart',
  'ex',
  'exs',
  'erl',
  'clj',
  'hs',
  'elm',
  'zig',
  'nim',
  'graphql',
  'gql',
  'proto',
  'prisma',
  'tf',
  'tfvars',
  'hcl',
  'nix',
  'cmake',
  'mk',
  'gradle',
  'properties',
  'bat',
  'ps1',
  'fish',
  'rst',
  'adoc',
  'tex',
  'lock',
  'http'
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

/** Decode a base64 string as UTF-8 text. */
export function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** Base64-encode raw bytes, chunked so large files don't overflow the arg stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Encode text as base64 UTF-8 (counterpart of decodeBase64Utf8). */
export function encodeBase64Utf8(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

/**
 * Heuristic: does this file look like UTF-8 text? Samples the first 8KB —
 * any NUL byte means binary; otherwise decode non-fatally (the sample can
 * split a multibyte sequence at the boundary) and reject when replacement
 * characters or non-whitespace control characters exceed 2% of the sample.
 */
export function looksLikeTextFile(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192)
  if (sample.length === 0) return true
  for (const b of sample) if (b === 0) return false
  const text = new TextDecoder('utf-8').decode(sample)
  if (text.length === 0) return false
  let bad = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0xfffd) bad++
    else if (code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r' && ch !== '\f') {
      if (code !== 0x1b) bad++
    } else if (code === 0x7f) bad++
  }
  return bad / text.length <= 0.02
}

/** Pasted text longer than this becomes an attachment chip instead of flooding the composer. */
export const LONG_PASTE_THRESHOLD = 2000

/** Pick `base.ext`, `base-2.ext`, … avoiding names already attached. */
export function dedupeFilename(
  existing: (string | undefined)[],
  base: string,
  ext: string
): string {
  const taken = new Set(existing.filter((n): n is string => !!n))
  let name = `${base}.${ext}`
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}.${ext}`
  return name
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
