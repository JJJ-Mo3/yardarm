/**
 * `yardarm://` deep links, main-process side: protocol registration and the
 * queue between OS link delivery (macOS `open-url`, Windows/Linux launch and
 * `second-instance` argv — wired in src/main/index.ts) and the renderer
 * (system.deepLinkSignal / system.takeDeepLink). Links are parsed and
 * validated here with the pure parser in src/shared/deep-link.ts before they
 * get anywhere near a window; the main process never acts on one — it only
 * forwards the validated request, and the renderer turns it into a prefilled
 * new-chat dialog the user has to confirm.
 */
import { app } from 'electron'
import { DEEP_LINK_SCHEME, isDeepLinkUrl, parseDeepLink } from '../../shared/deep-link'
import { DeepLinkQueue } from './deep-link-queue'

export const deepLinkQueue = new DeepLinkQueue()

/**
 * Make this app the OS handler for `yardarm://`. Packaged builds only: a dev
 * run would otherwise re-point the scheme at the bare Electron binary and
 * hijack links meant for the installed app. (Packaged macOS builds also
 * declare the scheme in Info.plist via electron-builder.yml `protocols`.)
 */
export function registerDeepLinkProtocol(): void {
  if (!app.isPackaged) return
  try {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  } catch {
    // best-effort: the app works without link handling
  }
}

/** The first `yardarm://` entry in a process argv (Windows/Linux delivery), if any. */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  return argv.find((arg) => isDeepLinkUrl(arg)) ?? null
}

/** Validate an incoming link and queue the outcome (request or error) for a renderer. */
export function receiveDeepLink(url: string): void {
  deepLinkQueue.put(parseDeepLink(url))
}
