/**
 * Tests for compose-derived DATABASE_URL (the Factory template ships the key
 * commented out in .env.example, so the compose file is the only default).
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveComposeDatabaseUrl } from './factory-dir'

const tmpDirs: string[] = []

async function makeDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yardarm-factory-dir-'))
  tmpDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content)
  }
  return dir
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe('deriveComposeDatabaseUrl', () => {
  it('prefers the documented DATABASE_URL comment', async () => {
    const dir = await makeDir({
      'docker-compose.yml': [
        '# Usage:',
        '#   docker compose up -d',
        '#   export DATABASE_URL=postgres://user:pass@localhost:54329/mastracode_web',
        'services:',
        '  app-db:',
        '    image: pgvector/pgvector:pg18',
        '    ports:',
        "      - '54329:5432'"
      ].join('\n')
    })
    expect(await deriveComposeDatabaseUrl(dir)).toBe(
      'postgres://user:pass@localhost:54329/mastracode_web'
    )
  })

  it('reconstructs from the port mapping and POSTGRES_* defaults', async () => {
    const dir = await makeDir({
      'docker-compose.yml': [
        'services:',
        '  app-db:',
        '    image: pgvector/pgvector:pg18',
        '    ports:',
        "      - '54329:5432'",
        '    environment:',
        '      POSTGRES_USER: ${POSTGRES_USER:-user}',
        '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-pass}',
        '      POSTGRES_DB: ${POSTGRES_DB:-mastracode_web}'
      ].join('\n')
    })
    expect(await deriveComposeDatabaseUrl(dir)).toBe(
      'postgres://user:pass@localhost:54329/mastracode_web'
    )
  })

  it('handles literal environment values', async () => {
    const dir = await makeDir({
      'compose.yaml': [
        'services:',
        '  db:',
        '    image: postgres:16',
        '    ports:',
        '      - "5433:5432"',
        '    environment:',
        '      POSTGRES_USER: factory',
        '      POSTGRES_PASSWORD: secret',
        '      POSTGRES_DB: factory_db'
      ].join('\n')
    })
    expect(await deriveComposeDatabaseUrl(dir)).toBe(
      'postgres://factory:secret@localhost:5433/factory_db'
    )
  })

  it('returns null without a compose file or postgres port mapping', async () => {
    const empty = await makeDir({})
    expect(await deriveComposeDatabaseUrl(empty)).toBeNull()
    const noPg = await makeDir({
      'docker-compose.yml': ['services:', '  redis:', '    ports:', "      - '63799:6379'"].join(
        '\n'
      )
    })
    expect(await deriveComposeDatabaseUrl(noPg)).toBeNull()
  })
})
