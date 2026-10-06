/**
 * Navigation policy for embedded <webview> guests. Preview guests are
 * localhost-only. The Factory dashboard guest may also navigate to https
 * pages in-place: its sign-in is a full-page redirect chain
 * (localhost /auth/login → platform identity pages → localhost
 * /auth/callback, which sets the session cookie on the localhost origin),
 * so kicking the chain out to the system browser would strand the session
 * where the webview's persist:factory partition can never see it. Pure so
 * the policy is unit-testable; window-manager.ts applies it.
 */
import { isLocalhostHttpUrl } from '../../shared/localhost-url'

export type WebviewNavAction = 'allow' | 'external' | 'deny'

export type WebviewKind = 'preview' | 'factory'

/** Decide what a guest navigation/redirect to `url` should do. */
export function webviewNavAction(url: string, kind: WebviewKind): WebviewNavAction {
  if (isLocalhostHttpUrl(url)) return 'allow'
  if (kind === 'factory' && url.startsWith('https://')) return 'allow'
  if (url.startsWith('http://') || url.startsWith('https://')) return 'external'
  return 'deny'
}
