/**
 * Guards for values that reach git argv or the filesystem from the renderer.
 * A ref that starts with "-" would be parsed by git as an option (e.g.
 * `--output=<file>` makes diff/show write to an arbitrary path), and a
 * relative file path with ".." would escape the working tree.
 */
import path from 'node:path'

/** Throw unless `ref` is safe to pass to git as a revision argument. */
export function assertSafeRef(ref: string): string {
  // eslint-disable-next-line no-control-regex
  if (ref.length === 0 || ref.startsWith('-') || /[\s\u0000-\u001f\u007f]/.test(ref)) {
    throw new Error(`Invalid git ref: ${JSON.stringify(ref)}`)
  }
  return ref
}

/** Resolve `relPath` under `root`, throwing when it escapes the root. */
export function resolveInside(root: string, relPath: string): string {
  const base = path.resolve(root)
  const abs = path.resolve(base, relPath)
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error('Path escapes project root')
  }
  return abs
}
