/**
 * Zero-to-running Ollama support for the local-model wizard: detect whether
 * Ollama is running / installed / absent, and start it on request. No
 * auto-installers — the wizard links to ollama.com and polls until it's up.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { OllamaInstallStatus } from '../../../shared/mastra-settings'

const OLLAMA_APP = '/Applications/Ollama.app'

function ollamaOnPath(): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    return spawnSync(cmd, ['ollama'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

export async function ollamaInstallStatus(): Promise<OllamaInstallStatus> {
  try {
    const res = await fetch('http://localhost:11434/api/version', {
      signal: AbortSignal.timeout(1500)
    })
    if (res.ok) return 'running'
  } catch {
    // not running — fall through to install checks
  }
  if (process.platform === 'darwin' && existsSync(OLLAMA_APP)) return 'installed'
  if (ollamaOnPath()) return 'installed'
  return 'not-installed'
}

/**
 * Fire-and-forget start; the renderer polls the probe until the server
 * responds. On macOS the Ollama.app menu-bar agent starts the server itself.
 */
export function startOllama(): void {
  if (process.platform === 'darwin' && existsSync(OLLAMA_APP)) {
    spawn('open', ['-a', 'Ollama'], { stdio: 'ignore' }).unref()
    return
  }
  const child = spawn('ollama', ['serve'], { stdio: 'ignore', detached: true })
  child.on('error', () => {
    // Binary missing or not executable — the wizard's poll will time out and
    // show the preset hint instead.
  })
  child.unref()
}
