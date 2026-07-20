#!/usr/bin/env node
/**
 * Assert the slash-command registry accounts for every Mastra Code command
 * documented on code.mastra.ai. Each command must appear in either
 * BUILTIN_COMMANDS (wired to UI) or CLI_ONLY_COMMANDS (listed in /help).
 *
 * Run: node scripts/check-command-coverage.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Canonical command list from code.mastra.ai (TUI slash commands).
// prettier-ignore
const CANONICAL = [
  // modes & models
  'plan', 'build', 'fast', 'mode', 'model', 'models', 'think',
  // approvals & permissions
  'yolo', 'permissions',
  // goals & memory
  'goal', 'om', 'resource',
  // threads
  'new', 'threads', 'thread', 'name', 'clone', 'thread:tag-dir',
  // usage & git
  'cost', 'diff',
  // config & extensions
  'settings', 'theme', 'mcp', 'hooks', 'commands', 'skills', 'skill',
  'subagents', 'custom-providers',
  // auth
  'login', 'logout', 'api-keys',
  // integrations (TUI-only)
  'sandbox', 'review', 'github', 'observability', 'voice', 'browser',
  // meta
  'help', 'setup', 'update', 'report-issue', 'exit'
]

const registryPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src/renderer/src/features/agents/slash-commands.ts'
)
const src = fs.readFileSync(registryPath, 'utf8')

const registered = new Set([...src.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]))

const missing = CANONICAL.filter((c) => !registered.has(c))
const extra = [...registered].filter((c) => !CANONICAL.includes(c))

if (missing.length > 0) {
  console.error('Commands on code.mastra.ai missing from the registry:')
  for (const c of missing) console.error(`  /${c}`)
}
if (extra.length > 0) {
  console.warn('Registry commands not in the canonical list (update CANONICAL if intended):')
  for (const c of extra) console.warn(`  /${c}`)
}
if (missing.length > 0) process.exit(1)
console.log(
  `OK: all ${CANONICAL.length} canonical commands accounted for (${registered.size} registered).`
)
