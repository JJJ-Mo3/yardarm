/**
 * Main-process side of the Preview tab's "Screenshot to chat" and "Pick
 * element" actions. Both act on a guest webContents id supplied by the
 * renderer, so every entry point goes through `resolvePreviewPage`, which
 * only accepts a registered <webview> guest that lives on the `preview`
 * partition and is currently showing a localhost document (the registry also
 * holds the Factory dashboard guest, which must never be scripted or
 * captured from here).
 *
 * The picker is injected with executeJavaScriptInIsolatedWorld: no preload is
 * added to the webview and no webPreference or permission changes. The
 * isolated world shares the page's DOM but not its JS globals, so page
 * scripts can't reach the picker's cancel hook. Its result is still treated
 * as untrusted and goes through parsePickResult before leaving this module.
 */
import { session, webContents, type NativeImage, type WebContents } from 'electron'
import { isLocalhostHttpUrl } from '../../shared/localhost-url'
import {
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_ROUNDS,
  elementCropRect,
  fitWithin,
  pngDimensions,
  shrinkForBytes,
  type PixelRect
} from '../lib/preview/capture-budget'
import { formatPickForComposer, parsePickResult, pickLabel } from '../lib/preview/pick-selection'
import { PICKER_CANCEL_SCRIPT, PICKER_SCRIPT } from '../lib/preview/picker-script'
import { isPreviewGuest } from './preview-guests'

/** Isolated world the picker runs in (999 is Electron's own preload world). */
const PICKER_WORLD_ID = 1001
/** A pick left waiting this long resolves as cancelled. */
export const PICK_TIMEOUT_MS = 120_000
/** capturePage can stall on a page that isn't painting; give up after this. */
const CAPTURE_TIMEOUT_MS = 8_000

export interface CapturedImage {
  /** Base64-encoded image bytes. */
  data: string
  mediaType: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

export type PickCancelReason = 'user' | 'navigated' | 'gone' | 'timeout' | 'superseded' | 'invalid'

export type PickOutcome =
  | { status: 'cancelled'; reason: PickCancelReason }
  | {
      status: 'picked'
      /** Short label such as `button#save`. */
      label: string
      /** Composer-ready description of the element. */
      text: string
      /** Screenshot cropped to the element; null when the capture failed. */
      image: CapturedImage | null
    }

/** Verified preview guest for a renderer-supplied webContents id, or throws. */
function resolvePreviewPage(pageId: number): WebContents {
  if (!isPreviewGuest(pageId)) throw new Error('Not a preview webview')
  const page = webContents.fromId(pageId)
  if (!page || page.isDestroyed()) throw new Error('Preview page is gone')
  if (page.session !== session.fromPartition('preview')) throw new Error('Not a preview webview')
  if (!isLocalhostHttpUrl(page.getURL())) throw new Error('No localhost page is loaded')
  return page
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * Encode a capture inside the size budget: downscale to the edge/pixel caps,
 * then PNG, then JPEG, then keep shrinking until the bytes fit. Dimensions are
 * read back from the encoded PNG each round rather than assumed, because a
 * HiDPI capture's logical size differs from its pixel size.
 */
function encodeWithinBudget(source: NativeImage): CapturedImage {
  let image = source
  for (let round = 0; round < MAX_CAPTURE_ROUNDS; round++) {
    const png = image.toPNG()
    const dims = pngDimensions(png)
    if (!dims) break
    const fit = fitWithin(dims)
    let target = fit
    if (fit.width === dims.width && fit.height === dims.height) {
      if (png.length <= MAX_CAPTURE_BYTES) {
        return { data: png.toString('base64'), mediaType: 'image/png', ...dims }
      }
      const jpeg = image.toJPEG(85)
      if (jpeg.length > 0 && jpeg.length <= MAX_CAPTURE_BYTES) {
        return { data: jpeg.toString('base64'), mediaType: 'image/jpeg', ...dims }
      }
      target = shrinkForBytes(dims, jpeg.length > 0 ? jpeg.length : png.length)
    }
    // resize() takes logical units; convert the pixel target through the
    // measured pixels-per-logical-unit ratio of the current image.
    const logical = image.getSize()
    const ratio = logical.width > 0 ? dims.width / logical.width : 1
    image = image.resize({
      width: Math.max(1, Math.round(target.width / ratio)),
      height: Math.max(1, Math.round(target.height / ratio)),
      quality: 'good'
    })
    if (image.isEmpty()) break
  }
  throw new Error('The capture could not be reduced to an attachable size')
}

async function capture(page: WebContents, rect?: PixelRect): Promise<CapturedImage> {
  const image = await withTimeout(
    rect ? page.capturePage(rect) : page.capturePage(),
    CAPTURE_TIMEOUT_MS,
    'Capturing the preview timed out — is the Preview tab visible?'
  )
  if (image.isEmpty()) throw new Error('The preview returned an empty capture')
  return encodeWithinBudget(image)
}

/** Screenshot of the visible part of a preview page, inside the size budget. */
export async function capturePreviewPage(pageId: number): Promise<CapturedImage> {
  return capture(resolvePreviewPage(pageId))
}

/** Cancel functions for in-flight picks, keyed by guest webContents id. */
const activePicks = new Map<number, (reason: PickCancelReason) => void>()

/** Cancels the pick running in a guest, if any. Safe to call for unknown ids. */
export function cancelPreviewPick(pageId: number): void {
  activePicks.get(pageId)?.('user')
}

/**
 * Runs the element picker in a preview guest and resolves once the user
 * picks an element or the pick is cancelled — by Esc in the page, by
 * `cancelPreviewPick`, by a newer pick, by a main-frame navigation, by the
 * guest going away, or by the timeout. Never hangs on the page's promise.
 */
export async function pickPreviewElement(pageId: number): Promise<PickOutcome> {
  const page = resolvePreviewPage(pageId)
  activePicks.get(pageId)?.('superseded')

  let cancel: (reason: PickCancelReason) => void = () => {}
  const cancelled = new Promise<{ cancelReason: PickCancelReason }>((resolve) => {
    cancel = (reason) => resolve({ cancelReason: reason })
  })
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
    if (details.isMainFrame && !details.isSameDocument) cancel('navigated')
  }
  const onGone = (): void => cancel('gone')
  const timer = setTimeout(() => cancel('timeout'), PICK_TIMEOUT_MS)
  page.on('did-start-navigation', onNavigation)
  page.once('destroyed', onGone)
  page.once('render-process-gone', onGone)
  activePicks.set(pageId, cancel)

  let settled: { raw: unknown } | { cancelReason: PickCancelReason }
  try {
    settled = await Promise.race([
      page.executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [{ code: PICKER_SCRIPT }]).then(
        (raw: unknown) => ({ raw }),
        // Rejects when the frame goes away mid-pick or the script throws.
        () => ({ cancelReason: 'gone' as const })
      ),
      cancelled
    ])
  } finally {
    clearTimeout(timer)
    if (activePicks.get(pageId) === cancel) activePicks.delete(pageId)
    if (!page.isDestroyed()) {
      page.removeListener('did-start-navigation', onNavigation)
      page.removeListener('destroyed', onGone)
      page.removeListener('render-process-gone', onGone)
    }
  }

  if ('cancelReason' in settled) {
    // Tear down the in-page overlay and listeners. Skipped when a newer pick
    // superseded this one: its script already cancelled ours, and running the
    // cancel script now would cancel the new pick instead.
    if (settled.cancelReason !== 'superseded' && !page.isDestroyed()) {
      page
        .executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [{ code: PICKER_CANCEL_SCRIPT }])
        .catch(() => {})
    }
    return { status: 'cancelled', reason: settled.cancelReason }
  }

  const parsed = parsePickResult(settled.raw)
  if (parsed.kind === 'cancelled') return { status: 'cancelled', reason: 'user' }
  if (parsed.kind === 'invalid') return { status: 'cancelled', reason: 'invalid' }

  let image: CapturedImage | null = null
  try {
    // Re-verify: the page may have navigated between the click and here.
    const current = resolvePreviewPage(pageId)
    const rect = elementCropRect(
      parsed.element.box,
      parsed.element.viewport,
      current.getZoomFactor()
    )
    if (rect) image = await capture(current, rect)
  } catch {
    // The text description is still useful without the cropped screenshot.
  }
  return {
    status: 'picked',
    label: pickLabel(parsed.element),
    text: formatPickForComposer(parsed.element),
    image
  }
}
