/**
 * Opening chat folders in external apps: detects which of the known apps are
 * installed (cached after the first scan) and launches one. macOS scans app
 * bundles and launches via `open -a`; Linux/Windows detect CLI launchers on
 * the login PATH (plus a terminal probe: Windows Terminal/PowerShell on
 * Windows, common emulators on Linux). The file manager entry always works
 * via shell.showItemInFolder.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import { z } from 'zod'
import { findExecutable } from '../../../agent-host/lsp-diagnostics'
import {
  APP_META,
  EXTERNAL_APPS,
  externalAppSchema,
  type DetectedExternalApp,
  type ExternalApp
} from '../../../../shared/external-apps'
import { getLoginPath } from '../../system/login-path'
import { publicProcedure, router } from '../trpc'

let detected: DetectedExternalApp[] | null = null

function pathEnv(): string | undefined {
  return getLoginPath() ?? process.env.PATH
}

function labelFor(app: ExternalApp): string {
  const meta = APP_META[app]
  if (process.platform === 'win32') return meta.winLabel ?? meta.label
  if (process.platform !== 'darwin') return meta.linuxLabel ?? meta.label
  return meta.label
}

/** Common Linux terminal emulators, most-generic first. */
const LINUX_TERMINALS = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal']

function resolveLinuxTerminal(): string | null {
  for (const name of LINUX_TERMINALS) {
    const bin = findExecutable(name, pathEnv(), [])
    if (bin) return bin
  }
  return null
}

/** Which known apps exist on this machine (the file manager always does). */
function detectApps(): DetectedExternalApp[] {
  if (detected) return detected
  if (process.platform === 'darwin') {
    const home = os.homedir()
    detected = EXTERNAL_APPS.flatMap((app): DetectedExternalApp[] => {
      if (app === 'finder') return [{ app, label: labelFor(app) }]
      const bundle = `${APP_META[app].macAppName}.app`
      const installed = [
        path.join('/Applications', bundle),
        path.join(home, 'Applications', bundle),
        path.join('/System/Applications', bundle),
        path.join('/System/Applications/Utilities', bundle)
      ].some((p) => existsSync(p))
      return installed ? [{ app, label: labelFor(app) }] : []
    })
    return detected
  }
  detected = EXTERNAL_APPS.flatMap((app): DetectedExternalApp[] => {
    if (app === 'finder') return [{ app, label: labelFor(app) }]
    if (app === 'terminal') {
      if (process.platform === 'win32') {
        const wt = findExecutable('wt', pathEnv(), [])
        return [{ app, label: wt ? 'Windows Terminal' : 'PowerShell' }]
      }
      return resolveLinuxTerminal() ? [{ app, label: labelFor(app) }] : []
    }
    const cli = APP_META[app].cli
    if (!cli || !findExecutable(cli, pathEnv(), [])) return []
    return [{ app, label: labelFor(app) }]
  })
  return detected
}

/**
 * Fire-and-forget launch. Windows .cmd/.bat launchers (VS Code's `code.cmd`)
 * can only run through a shell, so their path + args are quoted and anything
 * containing a double quote is rejected outright.
 */
function launchDetached(bin: string, args: string[], cwd?: string): void {
  let child
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    if ([bin, ...args].some((s) => s.includes('"'))) {
      throw new Error('Path contains unsupported characters')
    }
    child = spawn([bin, ...args].map((s) => `"${s}"`).join(' '), {
      shell: true,
      detached: true,
      stdio: 'ignore',
      cwd
    })
  } else {
    child = spawn(bin, args, { detached: true, stdio: 'ignore', cwd })
  }
  child.unref()
}

function openOnNonMac(app: ExternalApp, target: string): void {
  if (app === 'terminal') {
    if (process.platform === 'win32') {
      const wt = findExecutable('wt', pathEnv(), [])
      if (wt) launchDetached(wt, ['-d', target])
      else launchDetached('cmd.exe', ['/c', 'start', 'powershell', '-NoExit'], target)
      return
    }
    const term = resolveLinuxTerminal()
    if (!term) throw new Error('No terminal emulator found on PATH')
    launchDetached(term, [], target)
    return
  }
  const cli = APP_META[app].cli
  const bin = cli ? findExecutable(cli, pathEnv(), []) : null
  if (!bin) throw new Error(`${labelFor(app)} is not installed or not on your PATH`)
  launchDetached(bin, [target])
}

export const externalRouter = router({
  detectApps: publicProcedure.query(() => detectApps()),

  /** Reveals the folder in the file manager or opens it in the chosen app. */
  openPathInApp: publicProcedure
    .input(z.object({ app: externalAppSchema, path: z.string().min(1) }))
    .mutation(({ input }) => {
      if (!existsSync(input.path)) throw new Error(`Folder no longer exists: ${input.path}`)
      if (input.app === 'finder') {
        shell.showItemInFolder(input.path)
        return { ok: true }
      }
      if (process.platform === 'darwin') {
        // Fire-and-forget launch; `open` returns immediately on success.
        launchDetached('open', ['-a', APP_META[input.app].macAppName, input.path])
        return { ok: true }
      }
      openOnNonMac(input.app, input.path)
      return { ok: true }
    })
})
