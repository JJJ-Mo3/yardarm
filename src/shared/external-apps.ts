/**
 * External apps a chat's working folder can be opened in: the canonical app
 * list, its zod schema and display metadata, shared by the external tRPC
 * router (detection + launch) and the Open-locally header menu. Detection is
 * per platform: macOS scans app bundles, Linux/Windows look for CLI launchers
 * on the login PATH (labels come back from the router, already localized to
 * the platform — e.g. File Explorer instead of Finder).
 */
import { z } from 'zod'

export const EXTERNAL_APPS = [
  'finder',
  'vscode',
  'cursor',
  'zed',
  'terminal',
  'iterm',
  'warp',
  'ghostty'
] as const

export const externalAppSchema = z.enum(EXTERNAL_APPS)
export type ExternalApp = z.infer<typeof externalAppSchema>

/** A detected app plus its platform-appropriate display label. */
export interface DetectedExternalApp {
  app: ExternalApp
  label: string
}

export interface ExternalAppMeta {
  label: string
  /** macOS application name used with `open -a` and for bundle detection. */
  macAppName: string
  /** CLI launcher looked up on PATH for Linux/Windows detection + launch. */
  cli?: string
  /** Label overrides for the platform file manager. */
  winLabel?: string
  linuxLabel?: string
}

export const APP_META: Record<ExternalApp, ExternalAppMeta> = {
  finder: { label: 'Finder', macAppName: 'Finder', winLabel: 'File Explorer', linuxLabel: 'Files' },
  vscode: { label: 'VS Code', macAppName: 'Visual Studio Code', cli: 'code' },
  cursor: { label: 'Cursor', macAppName: 'Cursor', cli: 'cursor' },
  zed: { label: 'Zed', macAppName: 'Zed', cli: 'zed' },
  terminal: { label: 'Terminal', macAppName: 'Terminal' },
  iterm: { label: 'iTerm', macAppName: 'iTerm' },
  warp: { label: 'Warp', macAppName: 'Warp' },
  ghostty: { label: 'Ghostty', macAppName: 'Ghostty', cli: 'ghostty' }
}
