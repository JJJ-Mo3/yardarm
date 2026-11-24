import { describe, expect, it } from 'vitest'
import { pickDevCommand, pickStaticCommand, scriptTakesPortFlag } from './dev-command'

describe('scriptTakesPortFlag', () => {
  it('recognizes plain invocations of port-flag dev servers', () => {
    for (const body of [
      'vite',
      'vite dev',
      'vite --host',
      'vite serve --open',
      'astro dev',
      'ng serve',
      'webpack serve --mode development',
      'webpack-dev-server'
    ]) {
      expect(scriptTakesPortFlag(body)).toBe(true)
    }
  })

  it('leaves everything else alone', () => {
    for (const body of [
      '',
      'next dev',
      'node server.js',
      'vite build',
      'vite preview',
      'vite --port 3000',
      'vite --port=3000',
      'ng serve -p 4000',
      'astro build',
      'vite && echo done',
      'tsc -w & vite',
      'PORT=3000 vite',
      'cross-env NODE_ENV=dev vite',
      'vite $ARGS',
      'concurrently "vite" "tsc -w"',
      'npm run build; vite'
    ]) {
      expect(scriptTakesPortFlag(body)).toBe(false)
    }
  })
})

describe('pickDevCommand with a port', () => {
  it('appends --port for port-flag tools, with -- only for npm', () => {
    expect(pickDevCommand({ dev: 'vite' }, 'pnpm', 4100)).toEqual({
      command: 'pnpm run dev --port 4100',
      script: 'dev',
      label: 'dev server',
      port: 4100,
      portVia: 'flag'
    })
    expect(pickDevCommand({ dev: 'vite' }, 'npm', 4100)?.command).toBe('npm run dev -- --port 4100')
    expect(pickDevCommand({ dev: 'astro dev' }, 'yarn', 4100)?.command).toBe(
      'yarn run dev --port 4100'
    )
    expect(pickDevCommand({ dev: 'vite' }, 'bun', 4100)?.command).toBe('bun run dev --port 4100')
  })

  it('leaves the command unchanged and relies on PORT for other scripts', () => {
    expect(pickDevCommand({ dev: 'next dev' }, 'pnpm', 4100)).toEqual({
      command: 'pnpm run dev',
      script: 'dev',
      label: 'dev server',
      port: 4100,
      portVia: 'env'
    })
    expect(pickDevCommand({ dev: 'vite --port 3000' }, 'pnpm', 4100)?.command).toBe('pnpm run dev')
  })

  it('ignores a missing or invalid port', () => {
    const plain = { command: 'pnpm run dev', script: 'dev', label: 'dev server' }
    expect(pickDevCommand({ dev: 'vite' }, 'pnpm', null)).toEqual(plain)
    expect(pickDevCommand({ dev: 'vite' }, 'pnpm', 0)).toEqual(plain)
    expect(pickDevCommand({ dev: 'vite' }, 'pnpm', 4100.5)).toEqual(plain)
    expect(pickDevCommand({ dev: 'vite' }, 'pnpm', 70000)).toEqual(plain)
  })
})

describe('pickStaticCommand with a port', () => {
  it('serves on the given port', () => {
    expect(pickStaticCommand(['index.html'], 4250)).toEqual({
      command: 'python3 -m http.server 4250 --bind 127.0.0.1',
      script: 'static',
      label: 'static file server',
      port: 4250,
      portVia: 'arg'
    })
  })
})
