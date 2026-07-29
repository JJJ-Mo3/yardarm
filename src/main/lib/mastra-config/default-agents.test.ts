/** Tests for the default subagents catalog and its install behavior. */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_AGENTS, installDefaultAgents } from './default-agents'
import {
  RESERVED_SUBAGENT_IDS,
  parseAgentMarkdown,
  serializeAgentMarkdown,
  writeAgentFile
} from './agents-fs'

describe('DEFAULT_AGENTS catalog', () => {
  it('has 12 roles and 6 domain specialists with unique, valid ids', () => {
    expect(DEFAULT_AGENTS).toHaveLength(18)
    expect(DEFAULT_AGENTS.filter((d) => d.group === 'role')).toHaveLength(12)
    expect(DEFAULT_AGENTS.filter((d) => d.group === 'specialist')).toHaveLength(6)
    const ids = DEFAULT_AGENTS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[\w-]+$/)
      expect(RESERVED_SUBAGENT_IDS as readonly string[]).not.toContain(id)
    }
  })

  it('ships complete data with only the intended fields set', () => {
    for (const { id, data } of DEFAULT_AGENTS) {
      expect(data.name.trim(), id).not.toBe('')
      expect(data.description.trim(), id).not.toBe('')
      expect(data.instructions.trim(), id).not.toBe('')
      // Defaults follow the chat model and standard step limits.
      expect(data.model, id).toBeUndefined()
      expect(data.maxSteps, id).toBeUndefined()
      expect(data.forked, id).toBeUndefined()
    }
  })

  it('keeps descriptions single-line and frontmatter-safe', () => {
    for (const { id, data } of DEFAULT_AGENTS) {
      expect(data.description, id).not.toMatch(/[\r\n]/)
      expect(data.description.length, id).toBeLessThan(200)
      // The parser strips leading/trailing quote chars — they must not carry meaning.
      expect(data.description, id).not.toMatch(/^['"]|['"]$/)
    }
  })

  it('keeps instruction bodies within the boot-payload budget', () => {
    for (const { id, data } of DEFAULT_AGENTS) {
      expect(data.instructions.length, id).toBeLessThanOrEqual(4000)
    }
  })

  it('round-trips every entry through serialize/parse unchanged', () => {
    for (const { id, data } of DEFAULT_AGENTS) {
      expect(parseAgentMarkdown(id, serializeAgentMarkdown(data)), id).toEqual({
        ...data,
        model: undefined,
        maxSteps: undefined,
        forked: undefined
      })
    }
  })

  it('contains no emoji', () => {
    const emoji = /\p{Extended_Pictographic}/u
    for (const { id, data } of DEFAULT_AGENTS) {
      expect(emoji.test(data.name + data.description + data.instructions), id).toBe(false)
    }
  })
})

describe('installDefaultAgents', () => {
  let tmpDir: string | null = null

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
    tmpDir = null
  })

  async function makeProjectDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yardarm-default-agents-'))
    return tmpDir
  }

  it('installs fresh agents and skips them all on reinstall', async () => {
    const projectPath = await makeProjectDir()
    const ids = ['developer', 'qa-engineer', 'saas-specialist']
    const first = await installDefaultAgents(projectPath, ids)
    expect(first).toEqual({ installed: ids, skipped: [] })
    for (const id of ids) {
      const raw = await fs.readFile(
        path.join(projectPath, '.mastracode', 'agents', `${id}.md`),
        'utf8'
      )
      expect(parseAgentMarkdown(id, raw)).toEqual(DEFAULT_AGENTS.find((d) => d.id === id)?.data)
    }
    const second = await installDefaultAgents(projectPath, ids)
    expect(second).toEqual({ installed: [], skipped: ids })
  })

  it('never overwrites an existing customized agent file', async () => {
    const projectPath = await makeProjectDir()
    await writeAgentFile(projectPath, 'developer', {
      name: 'My Developer',
      description: 'Customized',
      instructions: 'Do it my way.'
    })
    const file = path.join(projectPath, '.mastracode', 'agents', 'developer.md')
    const before = await fs.readFile(file, 'utf8')
    const result = await installDefaultAgents(projectPath, ['developer', 'tech-writer'])
    expect(result).toEqual({ installed: ['tech-writer'], skipped: ['developer'] })
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  it('dedupes requested ids and rejects unknown ones', async () => {
    const projectPath = await makeProjectDir()
    const result = await installDefaultAgents(projectPath, ['devops', 'devops'])
    expect(result).toEqual({ installed: ['devops'], skipped: [] })
    await expect(installDefaultAgents(projectPath, ['not-a-default'])).rejects.toThrow(
      /Unknown default agent id/
    )
  })
})
