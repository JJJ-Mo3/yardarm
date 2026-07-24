/**
 * Guard for recursive project-folder deletion: refuses paths that could take
 * out the filesystem root, the user's home directory, or any ancestor of it
 * (/, /Users, /Users/<name>, ...). A backstop against catastrophic paths, not
 * a security boundary — project paths come from the native folder picker or
 * git clone. Pure so it can be unit-tested; the caller passes os.homedir().
 * Existence is deliberately not checked: fs.rm with force tolerates missing.
 */
import path from 'node:path'

export function isSafeToDeleteDir(dirPath: string, homeDir: string): boolean {
  if (!path.isAbsolute(dirPath)) return false
  const resolved = path.resolve(dirPath)
  const home = path.resolve(homeDir)
  if (resolved === path.parse(resolved).root) return false // filesystem root
  if (resolved === home) return false // home itself
  if (home.startsWith(resolved + path.sep)) return false // ancestor of home
  return true
}
