/**
 * Full sandbox mode: OS-level isolation for agent shell commands.
 *
 * @mastra/core ships native isolation backends (macOS seatbelt via
 * sandbox-exec, Linux bubblewrap) but @mastra/code-sdk constructs the
 * workspace's LocalSandbox with isolation 'none' and exposes no way to turn
 * it on. We can't patch node_modules (packaging re-stages the runtime from
 * npm), and the SDK's workspace factory runs only once per session, so this
 * manager swaps the live Workspace's soft-private `_sandbox` field at
 * runtime: the replacement is built from `ws.sandbox.constructor` (same
 * class instance as the SDK's — no imports, no module-identity risk) with
 * isolation enabled and readWritePaths mirroring the filesystem allowlist.
 * Shell commands resolve the sandbox through the `sandbox` getter at spawn
 * time, so the swap takes effect on the next command; LSP keeps the original
 * sandbox's process manager and is unaffected.
 *
 * Fail visible: when the backend is unavailable or construction throws, the
 * original sandbox stays in place and the error is reported — the UI must
 * never claim isolation that isn't active.
 */

import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
import type { SandboxRuntimeInfo } from '../../shared/ipc-types'

/** Desired isolation state, normalized for drift comparison. */
export interface SandboxIsolationConfig {
  enabled: boolean
  allowNetwork: boolean
  /** Absolute, deduped, sorted write-allowed roots (workdir + allowlist). */
  readWritePaths: string[]
}

/**
 * Normalize the desired config: workingDirectory plus the filesystem
 * allowlist, absolute paths only, deduped and sorted so configsEqual can
 * compare order-insensitively.
 */
export function computeDesiredConfig(
  enabled: boolean,
  allowNetwork: boolean,
  workingDirectory: string,
  allowedPaths: string[]
): SandboxIsolationConfig {
  const roots = new Set<string>()
  for (const p of [workingDirectory, ...allowedPaths]) {
    if (typeof p === 'string' && path.isAbsolute(p)) roots.add(path.resolve(p))
  }
  return { enabled, allowNetwork, readWritePaths: [...roots].sort() }
}

/** Drift detector: flags plus set-equality of readWritePaths. */
export function configsEqual(a: SandboxIsolationConfig | null, b: SandboxIsolationConfig): boolean {
  if (!a) return false
  if (a.enabled !== b.enabled || a.allowNetwork !== b.allowNetwork) return false
  if (a.readWritePaths.length !== b.readWritePaths.length) return false
  return a.readWritePaths.every((p, i) => p === b.readWritePaths[i])
}

/**
 * Unique seatbelt profile path per sandbox construction. Uniqueness matters:
 * LocalSandbox reuses an existing profile file verbatim (stale after the
 * allowlist changes), and the default location is cwd/.sandbox-profiles —
 * inside the worktree, since the host chdirs there.
 */
export function makeProfilePath(tmpDir: string): string {
  return path.join(tmpDir, `yardarm-seatbelt-${Date.now()}-${randomUUID().slice(0, 8)}.sb`)
}

/** Minimal structural view of @mastra/core's LocalSandbox. */
interface SandboxLike {
  workingDirectory: string
  env?: Record<string, string>
  destroy?: () => Promise<void>
}

interface SandboxCtorLike {
  new (options: {
    workingDirectory: string
    env?: Record<string, string>
    isolation: string
    nativeSandbox: {
      readWritePaths: string[]
      allowNetwork: boolean
      seatbeltProfilePath?: string
    }
  }): SandboxLike
  detectIsolation?: () => { backend: string; available: boolean; message: string }
}

/** Minimal structural view of the SDK Workspace we operate on. */
export interface WorkspaceLike {
  sandbox: SandboxLike
  filesystem: { allowedPaths: string[] }
}

export interface IsolationDetection {
  backend: 'seatbelt' | 'bwrap' | 'none'
  available: boolean
  message: string
}

/**
 * Owns the isolated-sandbox lifecycle for one host process: capture the
 * SDK's original sandbox, build/swap isolated replacements on demand, and
 * restore the original on disable. All SDK access is structural and wrapped
 * defensively — on any drift the manager reports failure instead of leaving
 * the session half-isolated.
 */
export class SandboxIsolationManager {
  private originalSandbox: SandboxLike | null = null
  private currentIsolated: SandboxLike | null = null
  private currentProfilePath: string | null = null
  private appliedConfig: SandboxIsolationConfig | null = null
  private lastError: string | null = null

  /** Whether isolation is currently applied (cheap guard for event handlers). */
  get isolationActive(): boolean {
    return this.appliedConfig?.enabled === true
  }

  /** Backend availability for this platform (safe against SDK drift). */
  detect(ws: WorkspaceLike): IsolationDetection {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      return {
        backend: 'none',
        available: false,
        message: `OS-level sandboxing is not supported on ${process.platform}`
      }
    }
    try {
      const ctor = (this.originalSandbox ?? ws.sandbox).constructor as SandboxCtorLike
      const det = ctor.detectIsolation?.()
      if (!det) {
        return { backend: 'none', available: false, message: 'SDK does not expose detectIsolation' }
      }
      return {
        backend: det.backend === 'seatbelt' || det.backend === 'bwrap' ? det.backend : 'none',
        available: det.available === true,
        message: det.message
      }
    } catch (err) {
      return {
        backend: 'none',
        available: false,
        message: `isolation detection failed: ${String(err)}`
      }
    }
  }

  /**
   * Bring the workspace's sandbox in line with the requested state. No-op
   * when nothing changed; otherwise swaps `_sandbox` (enable/rebuild) or
   * restores the SDK's original sandbox (disable).
   */
  async apply(
    ws: WorkspaceLike,
    enabled: boolean,
    allowNetwork: boolean
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.originalSandbox) this.originalSandbox = ws.sandbox
    const desired = computeDesiredConfig(
      enabled,
      allowNetwork,
      this.originalSandbox.workingDirectory,
      ws.filesystem.allowedPaths
    )
    // No-op only when the config matches AND the swap is still in place —
    // a re-resolved workspace could carry a fresh, unswapped sandbox.
    if (
      configsEqual(this.appliedConfig, desired) &&
      (!enabled || ws.sandbox === this.currentIsolated)
    ) {
      return { ok: true }
    }

    if (!enabled) {
      ;(ws as unknown as { _sandbox: SandboxLike })._sandbox = this.originalSandbox
      await this.discardIsolated()
      this.appliedConfig = desired
      this.lastError = null
      return { ok: true }
    }

    const detection = this.detect(ws)
    if (!detection.available || detection.backend === 'none') {
      this.lastError = detection.message
      return { ok: false, error: detection.message }
    }

    let isolated: SandboxLike
    const profilePath = detection.backend === 'seatbelt' ? makeProfilePath(os.tmpdir()) : null
    try {
      const Ctor = this.originalSandbox.constructor as SandboxCtorLike
      isolated = new Ctor({
        workingDirectory: this.originalSandbox.workingDirectory,
        env: this.originalSandbox.env,
        isolation: detection.backend,
        nativeSandbox: {
          readWritePaths: desired.readWritePaths,
          allowNetwork: desired.allowNetwork,
          ...(profilePath ? { seatbeltProfilePath: profilePath } : {})
        }
      })
    } catch (err) {
      this.lastError = `failed to construct isolated sandbox: ${String(err)}`
      return { ok: false, error: this.lastError }
    }

    // A command already in flight finishes under its previous policy; the
    // next spawn resolves the swapped sandbox through the getter.
    await this.discardIsolated()
    this.currentIsolated = isolated
    this.currentProfilePath = profilePath
    ;(ws as unknown as { _sandbox: SandboxLike })._sandbox = isolated
    this.appliedConfig = desired
    this.lastError = null
    return { ok: true }
  }

  /**
   * Re-apply with the currently applied flags — picks up filesystem
   * allowlist changes (request_access grants). No-op when disabled.
   */
  async refreshPaths(ws: WorkspaceLike): Promise<void> {
    if (!this.appliedConfig?.enabled) return
    await this.apply(ws, this.appliedConfig.enabled, this.appliedConfig.allowNetwork)
  }

  /** Current status for the UI (never claims isolation that isn't active). */
  status(ws: WorkspaceLike): SandboxRuntimeInfo {
    const detection = this.detect(ws)
    return {
      enabled: this.appliedConfig?.enabled ?? false,
      allowNetwork: this.appliedConfig?.allowNetwork ?? true,
      available: detection.available,
      backend: detection.backend,
      ...(this.lastError ? { error: this.lastError } : {})
    }
  }

  /** Destroy the previous isolated sandbox and its profile (best-effort). */
  private async discardIsolated(): Promise<void> {
    const prev = this.currentIsolated
    const prevProfile = this.currentProfilePath
    this.currentIsolated = null
    this.currentProfilePath = null
    if (prev) {
      try {
        await prev.destroy?.()
      } catch {}
    }
    if (prevProfile) {
      try {
        await unlink(prevProfile)
      } catch {}
    }
  }
}
