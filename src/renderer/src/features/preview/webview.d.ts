/**
 * Minimal typings for Electron's <webview> tag, which the Preview tab uses to
 * embed localhost dev servers. tsconfig.web deliberately has no electron
 * types, and React 19 dropped the global JSX namespace, so we augment the
 * react module locally with just the attributes and methods we call.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

export interface WebviewElement extends HTMLElement {
  src: string
  loadURL(url: string): Promise<void>
  getURL(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  getWebContentsId(): number
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<WebviewElement>, WebviewElement> & {
        src?: string
        partition?: string
      }
    }
  }
}
