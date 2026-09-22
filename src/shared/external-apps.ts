/**
 * External macOS apps a chat's working folder can be opened in: the canonical
 * app list, its zod schema and display metadata, shared by the external tRPC
 * router (detection + launch) and the Open-locally header menu.
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

export interface ExternalAppMeta {
  label: string
  /** macOS application name used with `open -a` and for bundle detection. */
  macAppName: string
}

export const APP_META: Record<ExternalApp, ExternalAppMeta> = {
  finder: { label: 'Finder', macAppName: 'Finder' },
  vscode: { label: 'VS Code', macAppName: 'Visual Studio Code' },
  cursor: { label: 'Cursor', macAppName: 'Cursor' },
  zed: { label: 'Zed', macAppName: 'Zed' },
  terminal: { label: 'Terminal', macAppName: 'Terminal' },
  iterm: { label: 'iTerm', macAppName: 'iTerm' },
  warp: { label: 'Warp', macAppName: 'Warp' },
  ghostty: { label: 'Ghostty', macAppName: 'Ghostty' }
}
