import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { publicProcedure, router } from '../trpc'

const IGNORED = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  'dist',
  'out',
  '.next',
  '__pycache__'
])
const MAX_FILE_BYTES = 2 * 1024 * 1024

export interface FileNode {
  name: string
  path: string // relative to root
  type: 'file' | 'dir'
  children?: FileNode[]
}

async function readTree(root: string, rel: string, depth: number): Promise<FileNode[]> {
  const abs = path.join(root, rel)
  let entries: Dirent[]
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: FileNode[] = []
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      nodes.push({
        name: e.name,
        path: childRel,
        type: 'dir',
        children: depth > 0 ? await readTree(root, childRel, depth - 1) : undefined
      })
    } else if (e.isFile()) {
      nodes.push({ name: e.name, path: childRel, type: 'file' })
    }
  }
  nodes.sort((a, b) =>
    a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)
  )
  return nodes
}

async function listAllFiles(
  root: string,
  rel = '',
  acc: string[] = [],
  limit = 5000
): Promise<string[]> {
  if (acc.length >= limit) return acc
  const abs = path.join(root, rel)
  let entries: Dirent[]
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (IGNORED.has(e.name) || acc.length >= limit) continue
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) await listAllFiles(root, childRel, acc, limit)
    else if (e.isFile()) acc.push(childRel)
  }
  return acc
}

function resolveWithin(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Path escapes project root')
  }
  return abs
}

export const filesRouter = router({
  tree: publicProcedure
    .input(
      z.object({
        root: z.string(),
        dir: z.string().default(''),
        depth: z.number().int().min(0).max(3).default(0)
      })
    )
    .query(({ input }) => {
      resolveWithin(input.root, input.dir || '.')
      return readTree(input.root, input.dir, input.depth)
    }),

  read: publicProcedure
    .input(z.object({ root: z.string(), path: z.string() }))
    .query(async ({ input }) => {
      const abs = resolveWithin(input.root, input.path)
      const stat = await fs.stat(abs)
      const mtimeMs = stat.mtimeMs
      if (stat.size > MAX_FILE_BYTES) {
        return { path: input.path, content: null, tooLarge: true, binary: false, mtimeMs }
      }
      const buf = await fs.readFile(abs)
      if (buf.includes(0)) {
        return { path: input.path, content: null, tooLarge: false, binary: true, mtimeMs }
      }
      return {
        path: input.path,
        content: buf.toString('utf8'),
        tooLarge: false,
        binary: false,
        mtimeMs
      }
    }),

  /**
   * Save an IDE buffer. When `baseMtimeMs` is set, the write is rejected as a
   * conflict if the file's mtime no longer matches (another process — usually
   * the agent — changed or deleted it); omitting it force-writes ("Overwrite").
   * A `chatId` lets the agent be told about the user's edit — mid-run when
   * it's working, otherwise with the next prompt.
   */
  write: publicProcedure
    .input(
      z.object({
        root: z.string(),
        path: z.string(),
        content: z.string(),
        baseMtimeMs: z.number().optional(),
        chatId: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      const abs = resolveWithin(input.root, input.path)
      if (input.baseMtimeMs !== undefined) {
        let diskMtimeMs: number | null = null
        try {
          diskMtimeMs = (await fs.stat(abs)).mtimeMs
        } catch {
          // missing file → diskMtimeMs stays null (deleted-on-disk conflict)
        }
        if (diskMtimeMs !== input.baseMtimeMs) {
          return { ok: false as const, conflict: true as const, mtimeMs: diskMtimeMs }
        }
      }
      await fs.writeFile(abs, input.content, 'utf8')
      const stat = await fs.stat(abs)
      if (input.chatId) agentSessionManager.noteIdeEdit(input.chatId, input.path)
      return { ok: true as const, mtimeMs: stat.mtimeMs }
    }),

  /** Substring/fuzzy filename search for @-mentions. */
  search: publicProcedure
    .input(
      z.object({ root: z.string(), query: z.string(), limit: z.number().int().max(50).default(20) })
    )
    .query(async ({ input }) => {
      const all = await listAllFiles(input.root)
      const q = input.query.toLowerCase()
      if (!q) return all.slice(0, input.limit)
      const scored: Array<{ p: string; score: number }> = []
      for (const p of all) {
        const lower = p.toLowerCase()
        const base = path.basename(lower)
        let score = -1
        if (base.startsWith(q)) score = 0
        else if (base.includes(q)) score = 1
        else if (lower.includes(q)) score = 2
        else {
          // subsequence match on path
          let i = 0
          for (const ch of lower) if (ch === q[i]) i++
          if (i === q.length) score = 3
        }
        if (score >= 0) scored.push({ p, score })
      }
      scored.sort((a, b) => a.score - b.score || a.p.length - b.p.length)
      return scored.slice(0, input.limit).map((s) => s.p)
    })
})
