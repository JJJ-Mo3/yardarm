import { describe, expect, it } from 'vitest'
import { formatByteSize, imageMimeForPath, matchesImageSignature } from './image-preview'

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b)
const text = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('imageMimeForPath', () => {
  it('maps the supported extensions case-insensitively', () => {
    expect(imageMimeForPath('a/b/logo.PNG')).toBe('image/png')
    expect(imageMimeForPath('photo.jpg')).toBe('image/jpeg')
    expect(imageMimeForPath('photo.jpeg')).toBe('image/jpeg')
    expect(imageMimeForPath('anim.gif')).toBe('image/gif')
    expect(imageMimeForPath('pic.webp')).toBe('image/webp')
    expect(imageMimeForPath('icon.svg')).toBe('image/svg+xml')
    expect(imageMimeForPath('favicon.ico')).toBe('image/x-icon')
    expect(imageMimeForPath('old.bmp')).toBe('image/bmp')
  })

  it('returns null for everything else', () => {
    expect(imageMimeForPath('notes.md')).toBeNull()
    expect(imageMimeForPath('archive.png.zip')).toBeNull()
    expect(imageMimeForPath('png')).toBeNull()
    expect(imageMimeForPath('.png')).toBeNull()
    expect(imageMimeForPath('dir.png/file')).toBeNull()
    expect(imageMimeForPath('movie.mp4')).toBeNull()
    expect(imageMimeForPath('page.html')).toBeNull()
  })
})

describe('matchesImageSignature', () => {
  it('accepts real signatures', () => {
    expect(
      matchesImageSignature('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))
    ).toBe(true)
    expect(matchesImageSignature('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true)
    expect(matchesImageSignature('image/gif', text('GIF89a...'))).toBe(true)
    expect(matchesImageSignature('image/webp', text('RIFF\u0001\u0001\u0001\u0001WEBPVP8 '))).toBe(
      true
    )
    expect(matchesImageSignature('image/bmp', text('BM....'))).toBe(true)
    expect(matchesImageSignature('image/x-icon', bytes(0, 0, 1, 0, 1, 0, 16, 16))).toBe(true)
    expect(
      matchesImageSignature('image/svg+xml', text('<?xml version="1.0"?>\n<svg xmlns="x"></svg>'))
    ).toBe(true)
  })

  it('rejects content that does not match the claimed type', () => {
    expect(matchesImageSignature('image/png', text('<html><script>'))).toBe(false)
    expect(matchesImageSignature('image/jpeg', bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false)
    expect(matchesImageSignature('image/webp', text('RIFF....WAVEfmt '))).toBe(false)
    expect(matchesImageSignature('image/x-icon', bytes(0, 0, 3, 0, 1, 0))).toBe(false)
    expect(matchesImageSignature('image/x-icon', bytes(0, 0, 1, 0, 0, 0))).toBe(false)
    expect(matchesImageSignature('image/svg+xml', text('<html><body>hi</body></html>'))).toBe(false)
    expect(matchesImageSignature('image/svg+xml', bytes(0x3c, 0x73, 0x76, 0x67, 0x20, 0))).toBe(
      false
    )
    expect(matchesImageSignature('image/png', bytes())).toBe(false)
    expect(matchesImageSignature('text/html', text('<svg>'))).toBe(false)
  })
})

describe('formatByteSize', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatByteSize(0)).toBe('0 B')
    expect(formatByteSize(1023)).toBe('1023 B')
    expect(formatByteSize(1536)).toBe('1.5 KB')
    expect(formatByteSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatByteSize(-1)).toBe('')
  })
})
