/**
 * Info about the bundled mastracode runtime and any globally installed CLI.
 * The runtime ships inside the app (asarUnpacked node_modules); these helpers
 * only report on it — the agent host is what actually imports it.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** Version of the mastracode package bundled with the app, or null if missing. */
export function getMastracodeVersion(): string | null {
  const candidates = [
    // Packaged: unpacked from the asar so the utility process can import it.
    path.join(
      process.resourcesPath ?? '',
      'app.asar.unpacked',
      'node_modules',
      'mastracode',
      'package.json'
    ),
    // Dev (and packaged fallback via Electron's asar fs): app root node_modules.
    path.join(app.getAppPath(), 'node_modules', 'mastracode', 'package.json')
  ]
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string }
      if (typeof pkg.version === 'string') return pkg.version
    } catch {
      // try next candidate
    }
  }
  return null
}

export interface CliDetectResult {
  found: boolean
  version?: string
}

/** Check whether a global `mastracode` CLI is on PATH (best-effort, 5s cap). */
export function detectGlobalCli(): Promise<CliDetectResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: CliDetectResult): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    try {
      // shell:true so login-shell PATH additions (nvm, volta, homebrew) apply.
      const child = spawn('mastracode', ['--version'], { shell: true })
      let out = ''
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // ignore
        }
        finish({ found: false })
      }, 5000)
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      child.on('error', () => {
        clearTimeout(timer)
        finish({ found: false })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const version = out.trim().split('\n')[0]?.trim()
        if (code === 0 && version) finish({ found: true, version })
        else finish({ found: false })
      })
    } catch {
      finish({ found: false })
    }
  })
}
