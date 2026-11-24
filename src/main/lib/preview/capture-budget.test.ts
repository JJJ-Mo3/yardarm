import { describe, expect, it } from 'vitest'
import {
  ELEMENT_CROP_PADDING,
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_EDGE,
  MAX_CAPTURE_PIXELS,
  elementCropRect,
  fitWithin,
  pngDimensions,
  shrinkForBytes
} from './capture-budget'

describe('fitWithin', () => {
  it('leaves captures inside the budget untouched', () => {
    expect(fitWithin({ width: 1280, height: 800 })).toEqual({ width: 1280, height: 800 })
  })

  it('never upscales', () => {
    expect(fitWithin({ width: 10, height: 10 })).toEqual({ width: 10, height: 10 })
  })

  it('caps the longest edge and keeps the aspect ratio', () => {
    const out = fitWithin({ width: 5120, height: 1000 })
    expect(out.width).toBeLessThanOrEqual(MAX_CAPTURE_EDGE)
    expect(out.width / out.height).toBeCloseTo(5.12, 1)
  })

  it('applies the pixel budget to large near-square captures', () => {
    const out = fitWithin({ width: 3000, height: 3000 })
    expect(out.width * out.height).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS)
    expect(out.width).toBe(out.height)
  })

  it('keeps every edge at least 1px for extreme aspect ratios', () => {
    expect(fitWithin({ width: 100000, height: 1 }).height).toBe(1)
    expect(fitWithin({ width: 1, height: 100000 }).width).toBe(1)
  })

  it('tolerates junk input', () => {
    expect(fitWithin({ width: NaN, height: -5 })).toEqual({ width: 1, height: 1 })
  })
})

describe('shrinkForBytes', () => {
  it('scales by roughly the square root of the byte ratio', () => {
    const out = shrinkForBytes({ width: 1000, height: 1000 }, MAX_CAPTURE_BYTES * 2)
    expect(out.width).toBeGreaterThan(600)
    expect(out.width).toBeLessThan(700)
  })

  it('never drops below half the linear size in one round', () => {
    expect(shrinkForBytes({ width: 1000, height: 600 }, MAX_CAPTURE_BYTES * 1000)).toEqual({
      width: 500,
      height: 300
    })
  })

  it('always shrinks, so the loop converges', () => {
    expect(shrinkForBytes({ width: 2, height: 2 }, MAX_CAPTURE_BYTES + 1)).toEqual({
      width: 1,
      height: 1
    })
    expect(shrinkForBytes({ width: 1, height: 1 }, MAX_CAPTURE_BYTES + 1)).toEqual({
      width: 1,
      height: 1
    })
  })
})

describe('pngDimensions', () => {
  const header = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(33)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(b.buffer).setUint32(16, w)
    new DataView(b.buffer).setUint32(20, h)
    return b
  }

  it('reads width and height from IHDR', () => {
    expect(pngDimensions(header(2560, 1600))).toEqual({ width: 2560, height: 1600 })
    expect(pngDimensions(header(0x80000001, 1))).toEqual({ width: 0x80000001, height: 1 })
  })

  it('rejects non-PNG and truncated data', () => {
    expect(pngDimensions(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull()
    expect(pngDimensions(new Uint8Array(40))).toBeNull()
    expect(pngDimensions(header(0, 10))).toBeNull()
    expect(pngDimensions(header(10, 10).subarray(0, 20))).toBeNull()
  })
})

describe('elementCropRect', () => {
  const viewport = { width: 1000, height: 800 }
  const P = ELEMENT_CROP_PADDING

  it('pads the element box', () => {
    expect(elementCropRect({ x: 100, y: 200, width: 50, height: 20 }, viewport)).toEqual({
      x: 100 - P,
      y: 200 - P,
      width: 50 + 2 * P,
      height: 20 + 2 * P
    })
  })

  it('clips to the viewport', () => {
    expect(elementCropRect({ x: -40, y: 790, width: 2000, height: 500 }, viewport)).toEqual({
      x: 0,
      y: 790 - P,
      width: 1000,
      height: 10 + P
    })
  })

  it('scales by the zoom factor', () => {
    expect(elementCropRect({ x: 100, y: 100, width: 100, height: 100 }, viewport, 2, 0)).toEqual({
      x: 200,
      y: 200,
      width: 200,
      height: 200
    })
  })

  it('returns null for boxes outside the viewport', () => {
    expect(elementCropRect({ x: 5000, y: 0, width: 10, height: 10 }, viewport)).toBeNull()
    expect(elementCropRect({ x: 0, y: -500, width: 10, height: 10 }, viewport)).toBeNull()
  })

  it('returns null for untrustworthy numbers', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 }
    expect(elementCropRect({ ...box, x: NaN }, viewport)).toBeNull()
    expect(elementCropRect({ ...box, width: Infinity }, viewport)).toBeNull()
    expect(elementCropRect({ ...box, width: 1e9 }, viewport)).toBeNull()
    expect(elementCropRect({ ...box, width: -1 }, viewport)).toBeNull()
    expect(elementCropRect(box, viewport, 0)).toBeNull()
    expect(elementCropRect(box, { width: 0, height: 0 })).toBeNull()
  })
})
