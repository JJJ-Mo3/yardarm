/**
 * Opening chat folders in external macOS apps: detects which of the known
 * apps are installed (cached after the first scan) and launches one — Finder
 * reveals the folder, everything else goes through `open -a`. macOS-only;
 * detection returns an empty list on other platforms.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import { z } from 'zod'
import {
  APP_META,
  EXTERNAL_APPS,
  externalAppSchema,
  type ExternalApp
} from '../../../../shared/external-apps'
import { publicProcedure, router } from '../trpc'

let detected: ExternalApp[] | null = null

/** Which known apps exist on this Mac (Finder is always present). */
function detectApps(): ExternalApp[] {
  if (process.platform !== 'darwin') return []
  if (detected) return detected
  const home = os.homedir()
  detected = EXTERNAL_APPS.filter((app) => {
    if (app === 'finder') return true
    const bundle = `${APP_META[app].macAppName}.app`
    return [
      path.join('/Applications', bundle),
      path.join(home, 'Applications', bundle),
      path.join('/System/Applications', bundle),
      path.join('/System/Applications/Utilities', bundle)
    ].some((p) => existsSync(p))
  })
  return detected
}

export const externalRouter = router({
  detectApps: publicProcedure.query(() => detectApps()),

  /** Reveals the folder in Finder or opens it in the chosen app. */
  openPathInApp: publicProcedure
    .input(z.object({ app: externalAppSchema, path: z.string().min(1) }))
    .mutation(({ input }) => {
      if (process.platform !== 'darwin') {
        throw new Error('Opening in external apps is only supported on macOS')
      }
      if (!existsSync(input.path)) throw new Error(`Folder no longer exists: ${input.path}`)
      if (input.app === 'finder') {
        shell.showItemInFolder(input.path)
        return { ok: true }
      }
      // Fire-and-forget launch; `open` returns immediately on success.
      const child = spawn('open', ['-a', APP_META[input.app].macAppName, input.path], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      return { ok: true }
    })
})
