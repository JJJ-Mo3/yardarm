/**
 * Size-budget math for Preview-tab screenshots (pure — no Electron imports).
 * A capture is attached to the chat composer and sent to the model as an
 * image part, so it is bounded three ways: longest edge, total pixels, and
 * encoded bytes. The capture code (windows/preview-capture.ts) measures the
 * encoded image and asks these helpers what size to try next.
 */

export interface PixelSize {
  width: number
  height: number
}

export interface PixelRect extends PixelSize {
  x: number
  y: number
}

/** Longest edge of an attached capture, in pixels. */
export const MAX_CAPTURE_EDGE = 1568
/** Total pixel budget (guards extreme aspect ratios that pass the edge cap). */
export const MAX_CAPTURE_PIXELS = 1568 * 1200
/** Encoded size budget for one capture. */
export const MAX_CAPTURE_BYTES = 1024 * 1024
/** Upper bound on downscale/re-encode rounds before a capture is rejected. */
export const MAX_CAPTURE_ROUNDS = 6
/** Padding around a picked element's crop, in CSS px. */
export const ELEMENT_CROP_PADDING = 16
/** Sanity bound on any page-reported coordinate or dimension, in CSS px. */
export const MAX_PAGE_COORD = 100_000

const finite = (n: number): boolean => typeof n === 'number' && Number.isFinite(n)

/**
 * Largest size with the same aspect ratio that satisfies both the edge and
 * the pixel budget. Never upscales; every edge stays at least 1px.
 */
export function fitWithin(
  size: PixelSize,
  maxEdge: number = MAX_CAPTURE_EDGE,
  maxPixels: number = MAX_CAPTURE_PIXELS
): PixelSize {
  const width = Math.max(1, Math.floor(finite(size.width) ? size.width : 1))
  const height = Math.max(1, Math.floor(finite(size.height) ? size.height : 1))
  const scale = Math.min(
    1,
    maxEdge / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height))
  )
  if (scale >= 1) return { width, height }
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  }
}

/**
 * Next size to try when an encoding of `size` came out at `bytes` and the
 * budget is `maxBytes`. Encoded size scales roughly with pixel count, so the
 * linear scale is the square root of the byte ratio, with a 10% safety margin
 * and a floor of 0.5 so one round never discards more than 3/4 of the pixels.
 * Always strictly smaller than the input (down to 1×1) so the loop converges.
 */
export function shrinkForBytes(
  size: PixelSize,
  bytes: number,
  maxBytes: number = MAX_CAPTURE_BYTES
): PixelSize {
  const ratio = bytes > 0 ? maxBytes / bytes : 1
  const scale = Math.min(0.9, Math.max(0.5, Math.sqrt(ratio) * 0.9))
  return {
    width: Math.max(1, Math.min(size.width - 1, Math.floor(size.width * scale))),
    height: Math.max(1, Math.min(size.height - 1, Math.floor(size.height * scale)))
  }
}

/** Reads the pixel dimensions from a PNG's IHDR chunk; null if it isn't a PNG. */
export function pngDimensions(bytes: Uint8Array): PixelSize | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24) return null
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE[i]) return null
  // Chunk type at 12..15 must be IHDR; width/height are big-endian u32s after it.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null
  }
  const u32 = (o: number): number =>
    bytes[o] * 0x1000000 + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3]
  const width = u32(16)
  const height = u32(20)
  if (width < 1 || height < 1) return null
  return { width, height }
}

/**
 * Capture rectangle for a picked element: the element's viewport box grown by
 * `padding`, clipped to the viewport, then scaled by the page zoom factor
 * (getBoundingClientRect is in CSS px; capturePage wants view DIPs). Every
 * input is page-reported and therefore untrusted — non-finite or absurd
 * values, and boxes that don't intersect the viewport, yield null.
 */
export function elementCropRect(
  box: PixelRect,
  viewport: PixelSize,
  zoom: number = 1,
  padding: number = ELEMENT_CROP_PADDING
): PixelRect | null {
  const values = [box.x, box.y, box.width, box.height, viewport.width, viewport.height, zoom]
  if (!values.every(finite)) return null
  if (values.some((v) => Math.abs(v) > MAX_PAGE_COORD)) return null
  if (zoom <= 0 || viewport.width < 1 || viewport.height < 1) return null
  if (box.width < 0 || box.height < 0) return null
  const left = Math.max(0, box.x - padding)
  const top = Math.max(0, box.y - padding)
  const right = Math.min(viewport.width, box.x + box.width + padding)
  const bottom = Math.min(viewport.height, box.y + box.height + padding)
  if (right - left < 1 || bottom - top < 1) return null
  const x = Math.floor(left * zoom)
  const y = Math.floor(top * zoom)
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(right * zoom) - x),
    height: Math.max(1, Math.ceil(bottom * zoom) - y)
  }
}
