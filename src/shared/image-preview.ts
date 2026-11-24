/**
 * Image-preview rules for the IDE tab (pure, unit-tested; shared by the files
 * router and the renderer): which extensions count as previewable images,
 * their MIME types, the size cap, and a content sniff so a file is only ever
 * served as an image when its bytes actually look like that image type.
 */

/** Largest image the IDE tab will load for preview. */
export const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp'
}

/** MIME type for a previewable image path (by extension), or null. */
export function imageMimeForPath(filePath: string): string | null {
  const name = filePath.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return IMAGE_MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((b, i) => bytes[offset + i] === b)
}

/** Whether the bytes carry the signature of the given image MIME type. */
export function matchesImageSignature(mime: string, bytes: Uint8Array): boolean {
  switch (mime) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'image/gif':
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38])
    case 'image/webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      )
    case 'image/bmp':
      return startsWith(bytes, [0x42, 0x4d])
    case 'image/x-icon':
      // ICONDIR: reserved 0, type 1 (icon) or 2 (cursor), at least one image.
      return (
        bytes.length >= 6 &&
        bytes[0] === 0 &&
        bytes[1] === 0 &&
        (bytes[2] === 1 || bytes[2] === 2) &&
        bytes[3] === 0 &&
        (bytes[4] !== 0 || bytes[5] !== 0)
      )
    case 'image/svg+xml': {
      // Text, not binary, with an <svg element near the top.
      const head = bytes.subarray(0, 4096)
      if (head.includes(0)) return false
      let text = ''
      for (const b of head) text += String.fromCharCode(b)
      return /<svg[\s>]/i.test(text)
    }
    default:
      return false
  }
}

/** Human-readable byte size, e.g. "1.4 MB". */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
