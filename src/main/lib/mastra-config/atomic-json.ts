/**
 * Queued atomic JSON writes for config files that several code paths (and the
 * mastracode CLI) share. Writes to the same file run one at a time, so a
 * read-modify-write can't lose a concurrent update, and each lands via a
 * uniquely named temp file + rename so a crash never leaves it truncated.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const queues = new Map<string, Promise<unknown>>()

/** Run `task` after every earlier task queued for the same file. */
export function queuedForFile<T>(file: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(file)
  const run = (queues.get(key) ?? Promise.resolve()).then(task)
  // Keep the queue alive even if this task fails.
  const tail = run.catch(() => {})
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}

/** Atomically replace `file` with pretty-printed JSON. */
export async function writeJsonAtomic(file: string, data: unknown, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${randomUUID()}`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode })
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}
