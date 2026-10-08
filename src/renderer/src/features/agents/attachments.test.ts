import { describe, expect, it } from 'vitest'
import {
  buildAttachmentPrompt,
  bytesToBase64,
  classifyAttachment,
  decodeBase64Utf8,
  dedupeFilename,
  encodeBase64Utf8,
  looksLikeTextFile
} from './attachments'

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

describe('classifyAttachment', () => {
  it('classifies markdown by MIME type', () => {
    expect(classifyAttachment('text/markdown', 'notes.md')).toBe('text')
  })

  it('falls back to the extension when the MIME type is empty', () => {
    expect(classifyAttachment('', 'notes.md')).toBe('text')
    expect(classifyAttachment('', 'data.csv')).toBe('text')
  })

  it('classifies application text types as text', () => {
    expect(classifyAttachment('application/json', 'config.json')).toBe('text')
    expect(classifyAttachment('application/x-yaml', 'ci.yml')).toBe('text')
  })

  it('classifies svg as text, not image', () => {
    expect(classifyAttachment('image/svg+xml', 'logo.svg')).toBe('text')
  })

  it('classifies images and pdfs natively', () => {
    expect(classifyAttachment('image/png', 'shot.png')).toBe('image')
    expect(classifyAttachment('application/pdf', 'spec.pdf')).toBe('pdf')
  })

  it('matches extension-less well-known filenames', () => {
    expect(classifyAttachment('', 'Dockerfile')).toBe('text')
    expect(classifyAttachment('', 'Makefile')).toBe('text')
    expect(classifyAttachment('', 'Gemfile')).toBe('text')
    expect(classifyAttachment('', 'LICENSE')).toBe('text')
  })

  it('matches dotfiles and new language extensions', () => {
    expect(classifyAttachment('', '.npmrc')).toBe('text')
    expect(classifyAttachment('', '.editorconfig')).toBe('text')
    expect(classifyAttachment('', 'main.tf')).toBe('text')
    expect(classifyAttachment('', 'schema.graphql')).toBe('text')
  })

  it('rejects unknown binary types', () => {
    expect(classifyAttachment('application/octet-stream', 'blob.bin')).toBe('unsupported')
    expect(classifyAttachment('', 'archive.tar.gz')).toBe('unsupported')
  })
})

describe('looksLikeTextFile', () => {
  it('accepts plain ASCII', () => {
    expect(looksLikeTextFile(new TextEncoder().encode('hello world\nline two\n'))).toBe(true)
  })

  it('accepts multibyte UTF-8 split at the 8KB sample boundary', () => {
    // Fill right up to the boundary so a 3-byte char straddles offset 8192.
    const bytes = new TextEncoder().encode('a'.repeat(8191) + '日本語テキスト')
    expect(looksLikeTextFile(bytes)).toBe(true)
  })

  it('rejects NUL-containing binaries', () => {
    expect(looksLikeTextFile(new Uint8Array([0x68, 0x69, 0x00, 0x68, 0x69]))).toBe(false)
  })

  it('rejects PNG headers', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    expect(looksLikeTextFile(png)).toBe(false)
  })

  it('accepts empty files', () => {
    expect(looksLikeTextFile(new Uint8Array(0))).toBe(true)
  })
})

describe('dedupeFilename', () => {
  it('returns the base name when free', () => {
    expect(dedupeFilename([], 'pasted-text', 'txt')).toBe('pasted-text.txt')
  })

  it('suffixes -2, -3 … when taken', () => {
    expect(dedupeFilename(['pasted-text.txt'], 'pasted-text', 'txt')).toBe('pasted-text-2.txt')
    expect(
      dedupeFilename(['pasted-text.txt', 'pasted-text-2.txt', undefined], 'pasted-text', 'txt')
    ).toBe('pasted-text-3.txt')
  })
})

describe('base64 helpers', () => {
  it('decodeBase64Utf8 round-trips UTF-8 text', () => {
    const text = 'héllo wörld — ✓ 日本語'
    expect(decodeBase64Utf8(b64(text))).toBe(text)
  })

  it('encodeBase64Utf8 is the inverse of decodeBase64Utf8', () => {
    const text = 'emoji 🙂 and ünïcode'
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text)
  })

  it('bytesToBase64 chunking survives >128KB inputs', () => {
    const text = 'x'.repeat(200 * 1024) + '日本語'
    const bytes = new TextEncoder().encode(text)
    expect(decodeBase64Utf8(bytesToBase64(bytes))).toBe(text)
  })
})

describe('buildAttachmentPrompt', () => {
  it('inlines files as attached-file blocks and keeps the bubble clean', () => {
    const built = buildAttachmentPrompt('Summarize this.', [
      { data: b64('# Title\nBody'), mediaType: 'text/markdown', filename: 'notes.md' },
      { data: b64('a,b\n1,2'), mediaType: 'text/csv', filename: 'data.csv' }
    ])
    expect(built.content).toContain('Summarize this.')
    expect(built.content).toContain(
      '<attached-file name="notes.md">\n# Title\nBody\n</attached-file>'
    )
    expect(built.content).toContain('<attached-file name="data.csv">\na,b\n1,2\n</attached-file>')
    expect(built.displayText).toBe('Summarize this.\n\n[attached: notes.md, data.csv]')
  })

  it('labels nameless files', () => {
    const built = buildAttachmentPrompt('Look:', [{ data: b64('x'), mediaType: 'text/plain' }])
    expect(built.content).toContain('<attached-file name="file">')
    expect(built.displayText).toContain('[attached: text file]')
  })
})
