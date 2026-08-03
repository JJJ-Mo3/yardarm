import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_ACCEPT,
  buildAttachmentPrompt,
  classifyAttachment,
  decodeBase64Utf8
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
  })

  it('rejects unknown binary types', () => {
    expect(classifyAttachment('application/octet-stream', 'blob.bin')).toBe('unsupported')
    expect(classifyAttachment('', 'archive.tar.gz')).toBe('unsupported')
  })
})

describe('ATTACHMENT_ACCEPT', () => {
  it('covers images, pdfs, text and the extension list', () => {
    expect(ATTACHMENT_ACCEPT).toContain('image/*')
    expect(ATTACHMENT_ACCEPT).toContain('application/pdf')
    expect(ATTACHMENT_ACCEPT).toContain('text/*')
    expect(ATTACHMENT_ACCEPT).toContain('.md')
  })
})

describe('decodeBase64Utf8', () => {
  it('round-trips UTF-8 text', () => {
    const text = 'héllo wörld — ✓ 日本語'
    expect(decodeBase64Utf8(b64(text))).toBe(text)
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
