import { describe, expect, it } from 'vitest'
import {
  STATIC_SERVER_PORT,
  packageManagerFromLockfiles,
  pickDevCommand,
  pickStaticCommand
} from './dev-command'

describe('packageManagerFromLockfiles', () => {
  it('maps each lockfile to its package manager', () => {
    expect(packageManagerFromLockfiles(['pnpm-lock.yaml'])).toBe('pnpm')
    expect(packageManagerFromLockfiles(['yarn.lock'])).toBe('yarn')
    expect(packageManagerFromLockfiles(['bun.lockb'])).toBe('bun')
    expect(packageManagerFromLockfiles(['bun.lock'])).toBe('bun')
    expect(packageManagerFromLockfiles(['package-lock.json'])).toBe('npm')
  })

  it('defaults to npm when no lockfile is present', () => {
    expect(packageManagerFromLockfiles([])).toBe('npm')
  })

  it('prefers pnpm when multiple lockfiles exist', () => {
    expect(packageManagerFromLockfiles(['package-lock.json', 'pnpm-lock.yaml'])).toBe('pnpm')
  })
})

describe('pickDevCommand', () => {
  it('prefers dev over serve over start', () => {
    expect(pickDevCommand({ dev: 'vite', serve: 'x', start: 'y' }, 'pnpm')).toEqual({
      command: 'pnpm run dev',
      script: 'dev'
    })
    expect(pickDevCommand({ serve: 'x', start: 'y' }, 'npm')).toEqual({
      command: 'npm run serve',
      script: 'serve'
    })
    expect(pickDevCommand({ start: 'node server.js' }, 'yarn')).toEqual({
      command: 'yarn run start',
      script: 'start'
    })
  })

  it('returns null when no dev-like script exists', () => {
    expect(pickDevCommand({ build: 'tsc', test: 'vitest' }, 'npm')).toBeNull()
    expect(pickDevCommand({}, 'npm')).toBeNull()
  })

  it('ignores non-string script values', () => {
    expect(pickDevCommand({ dev: 42, start: 'node .' }, 'npm')).toEqual({
      command: 'npm run start',
      script: 'start'
    })
  })
})

describe('pickStaticCommand', () => {
  it('serves the directory when a root .html file exists', () => {
    expect(pickStaticCommand(['index.html', 'style.css'])).toEqual({
      command: `python3 -m http.server ${STATIC_SERVER_PORT} --bind 127.0.0.1`,
      script: 'static'
    })
  })

  it('matches .html case-insensitively', () => {
    expect(pickStaticCommand(['Hello-World.HTML'])?.script).toBe('static')
  })

  it('returns null when there is nothing html to serve', () => {
    expect(pickStaticCommand(['main.ts', 'README.md'])).toBeNull()
    expect(pickStaticCommand([])).toBeNull()
  })
})
