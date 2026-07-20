/**
 * Standalone Vitest config (electron-vite ignores this file). Tests are
 * co-located `*.test.ts(x)` next to the pure modules they cover and run in
 * a plain node environment — nothing under test may import Electron.
 */
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@': path.resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}']
  }
})
