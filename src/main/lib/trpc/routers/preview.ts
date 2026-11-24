/**
 * Preview router: screenshot and element-picker actions for the Preview tab.
 * The renderer passes the <webview> guest's webContents id; the capture
 * module verifies it is a preview-partition guest showing a localhost page
 * before touching it, and sanitizes everything the page returns.
 */
import { z } from 'zod'
import {
  cancelPreviewPick,
  capturePreviewPage,
  pickPreviewElement
} from '../../../windows/preview-capture'
import { publicProcedure, router } from '../trpc'

const pageInput = z.object({ pageWebContentsId: z.number().int().nonnegative() })

export const previewRouter = router({
  /** Capture the visible preview page as a size-capped image. */
  capture: publicProcedure
    .input(pageInput)
    .mutation(({ input }) => capturePreviewPage(input.pageWebContentsId)),

  /**
   * Run the element picker; stays pending until the user picks, cancels, the
   * page navigates or goes away, or the pick times out.
   */
  pickElement: publicProcedure
    .input(pageInput)
    .mutation(({ input }) => pickPreviewElement(input.pageWebContentsId)),

  /** Cancel a running pick. Lenient: the guest may already be gone. */
  cancelPick: publicProcedure.input(pageInput).mutation(({ input }) => {
    cancelPreviewPick(input.pageWebContentsId)
    return { ok: true }
  })
})
