/**
 * Files router backing the IDE tab and @-mentions: directory tree, file read
 * (text, plus size-capped image previews) and conflict-checked write, file listing/search, and language-server diagnostics.
 * Every path is confined to a known project folder or chat worktree.
 */
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { z } from 'zod'
import {
  imageMimeForPath,
  matchesImageSignature,
  MAX_IMAGE_PREVIEW_BYTES
} from '../../../../shared/image-preview'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { resolveInside } from '../../git/safe-ref'
import { assertKnownRoot } from '../../known-roots'
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

/**
 * Resolve a renderer-supplied path: the root must be a project folder or chat
 * worktree the app knows, and the path must stay inside it.
 */
function resolveWithin(root: string, relPath: string): string {
  return resolveInside(assertKnownRoot(root), relPath)
}

/**
 * Writes also follow symlinks, so check where the path really lands: a link
 * inside the tree that points outside it (e.g. at a shell rc file) must not be
 * writable through the editor. New files are checked via their parent.
 */
async function assertRealPathInside(root: string, abs: string): Promise<void> {
  const realRoot = await fs.realpath(path.resolve(root))
  let real: string
  try {
    real = await fs.realpath(abs)
  } catch {
    real = path.join(await fs.realpath(path.dirname(abs)), path.basename(abs))
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error('Path escapes project root')
  }
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
   * IDE image preview: returns a `data:` URL for a known image type only
   * (by extension, confirmed by a content sniff), capped at
   * MAX_IMAGE_PREVIEW_BYTES. The path is confined like every other read, and
   * additionally may not follow a symlink out of the root. The renderer shows
   * the URL in an `<img>` — SVG is never inlined into the DOM.
   */
  readImage: publicProcedure
    .input(z.object({ root: z.string(), path: z.string() }))
    .query(async ({ input }) => {
      const mime = imageMimeForPath(input.path)
      if (!mime) throw new Error('Not a previewable image type')
      const abs = resolveWithin(input.root, input.path)
      await assertRealPathInside(input.root, abs)
      const stat = await fs.stat(abs)
      if (!stat.isFile()) throw new Error('Not a file')
      const base = { path: input.path, mime, size: stat.size, mtimeMs: stat.mtimeMs }
      if (stat.size > MAX_IMAGE_PREVIEW_BYTES) {
        return { ...base, dataUrl: null, tooLarge: true, invalid: false }
      }
      const buf = await fs.readFile(abs)
      // Re-check after the read: the file may have grown since the stat.
      if (buf.length > MAX_IMAGE_PREVIEW_BYTES) {
        return { ...base, size: buf.length, dataUrl: null, tooLarge: true, invalid: false }
      }
      if (!matchesImageSignature(mime, buf)) {
        return { ...base, dataUrl: null, tooLarge: false, invalid: true }
      }
      return {
        ...base,
        size: buf.length,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        tooLarge: false,
        invalid: false
      }
    }),

  /**
   * Save an IDE buffer. When `baseMtimeMs` is set, the write is rejected as a
   * conflict if the file's mtime no longer matches (another process — usually
   * the agent — changed or deleted it); omitting it force-writes ("Overwrite").
   * Every chat working on `root` is told about the user's edit — mid-run when
   * its agent is working, otherwise with its next prompt.
   */
  write: publicProcedure
    .input(
      z.object({
        root: z.string(),
        path: z.string(),
        content: z.string(),
        baseMtimeMs: z.number().optional()
      })
    )
    .mutation(async ({ input }) => {
      const abs = resolveWithin(input.root, input.path)
      await assertRealPathInside(input.root, abs)
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
      agentSessionManager.noteIdeEditForRoot(input.root, input.path)
      return { ok: true as const, mtimeMs: stat.mtimeMs }
    }),

  /**
   * IDE problems panel: language-server diagnostics for one open file,
   * produced by the subchat's agent host (null subchatId = the shared
   * utility host, no chat required). Optional content diagnoses an unsaved
   * editor buffer instead of the on-disk file.
   */
  diagnostics: publicProcedure
    .input(
      z.object({
        subchatId: z.string().min(1).nullable(),
        root: z.string(),
        path: z.string(),
        content: z.string().optional()
      })
    )
    .query(({ input }) => {
      const abs = resolveWithin(input.root, input.path)
      return agentSessionManager.lspDiagnostics(input.subchatId, abs, input.root, input.content)
    }),

  /**
   * Flat file list for the quick-open dialog: git-tracked + untracked files
   * (respecting .gitignore), falling back to the plain walker for non-repos.
   * Capped at 5000 paths; the renderer fuzzy-filters client-side.
   */
  list: publicProcedure.input(z.object({ root: z.string() })).query(async ({ input }) => {
    try {
      const out = await simpleGit(assertKnownRoot(input.root)).raw([
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard'
      ])
      const files = out.split('\n').filter(Boolean)
      if (files.length > 0) return files.slice(0, 5000)
    } catch {
      // not a git repo (or git unavailable) — use the walker below
    }
    return listAllFiles(assertKnownRoot(input.root))
  }),

  /** Substring/fuzzy filename search for @-mentions. */
  search: publicProcedure
    .input(
      z.object({ root: z.string(), query: z.string(), limit: z.number().int().max(50).default(20) })
    )
    .query(async ({ input }) => {
      const all = await listAllFiles(assertKnownRoot(input.root))
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
